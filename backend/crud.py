import json
import re
import threading
from collections import Counter
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from pydantic import BaseModel
from sqlalchemy import and_, case, or_, func, text as sa_text
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, defer

import cache
from database import SessionLocal
from models import Position, Source
from major_map import expand_major
from normalizer import (
    normalize_edu,
    parse_location_tags,
    location_tree,
    ALL_PROVINCES,
    ALL_CITIES,
    CITY_TO_PROVINCE,
)


class PositionFilter(BaseModel):
    year: Optional[List[int]] = None
    job_type: Optional[List[str]] = None
    exam_type: Optional[List[str]] = None
    exam_type_norm: Optional[List[str]] = None
    province: Optional[List[str]] = None
    edu_requirement: Optional[List[str]] = None
    edu_level: Optional[List[str]] = None
    work_location: Optional[List[str]] = None
    keyword: Optional[str] = None
    # 智能筛选
    location: Optional[List[str]] = None
    major: Optional[str] = None
    major_type: Optional[str] = "any"  # undergrad | grad | any
    category: Optional[List[str]] = None
    hide_expired: Optional[bool] = None


# ---------- 职位类型关键词 ----------
CATEGORY_KEYWORDS = {
    "公务员": ["公务员", "国家公务员考试", "省公务员考试", "国考", "省考"],
    "事业单位/事业编": ["事业单位", "事业编"],
    "军队文职": ["军队文职"],
    "选调生": ["选调生"],
    "国企/央企": ["央企/国企", "国企", "央企", "国聘", "国企校园招聘", "央企校园招聘"],
    "上市公司": ["上市公司"],
    "其他企业": ["民营企业", "股份制企业", "中外合资", "其他"],
}


def keyword_variants(keyword: str) -> List[str]:
    """关键词可用「|」分隔多个同义变体（前端同义扩展），OR 匹配任意一个。"""
    return [v.strip() for v in keyword.split("|") if v.strip()] or [keyword]


def title_hit_rank(col, keyword: str):
    """标题列命中任一关键词变体则排前（0），否则排后（1）。"""
    return case(
        (or_(*(col.ilike(f"%{v}%") for v in keyword_variants(keyword))), 0),
        else_=1,
    )


#: 学历「可投递」匹配模式：选某学历时命中含该学历、更低学历「及以上」或「不限」的要求串
EDU_ELIGIBLE_PATTERNS: Dict[str, List[str]] = {
    "大专": ["%大专%", "%专科%", "%不限%"],
    "本科": ["%本科%", "%大专%及以上%", "%专科%及以上%", "%不限%"],
    "硕士": ["%硕士%", "%本科%及以上%", "%大专%及以上%", "%专科%及以上%", "%不限%"],
    "博士": ["%博士%", "%硕士%及以上%", "%本科%及以上%", "%大专%及以上%", "%专科%及以上%", "%不限%"],
}


def edu_eligible_clause(col, edu: str):
    """按「持有该学历者可投递」语义匹配学历要求列（未知学历回退子串匹配）。"""
    patterns = EDU_ELIGIBLE_PATTERNS.get(edu)
    if not patterns:
        return col.ilike(f"%{edu}%")
    return or_(*(col.ilike(p) for p in patterns))


def _hit_clause(col, keyword: str):
    return or_(*(col.ilike(f"%{v}%") for v in keyword_variants(keyword)))


def _kw_bigrams(v: str) -> List[str]:
    v = v.lower()
    return [v[i : i + 2] for i in range(len(v) - 1)]


def _bigram_hit_clause(col, keyword: str):
    """bigrams(col) @> ARRAY[..] GIN 预过滤 + 原 ILIKE 精确校验，结果集与纯 ILIKE 一致。

    2 字中文词无法提取 trigram，自建 bigram 表达式索引（migrate_trgm.py）可覆盖；
    单字词无 bigram，回退纯 ILIKE。"""
    clauses = []
    for v in keyword_variants(keyword):
        ilike = col.ilike(f"%{v}%")
        bgs = _kw_bigrams(v)
        if bgs:
            clauses.append(and_(func.bigrams(col).op("@>")(array(bgs)), ilike))
        else:
            clauses.append(ilike)
    return or_(*clauses)


TIER3_TIMEOUT_MS = 3000  # search_text 兜底层语句级超时，超时降级不入缓存
COUNT_BIGRAM_TIMEOUT_MS = 1000  # count 竞速 bigram 路超时（胜出场景冷查 ~0.4-0.7s，早停释放 IO）
COUNT_ILIKE_TIMEOUT_MS = 2200  # count 竞速纯 ILIKE 路超时（高频词 LIMIT 触顶 ~0.5-1.1s）
BITMAP_IO_CONCURRENCY = 64  # 位图堆扫描预取并发：冷缓存随机 IO 串行读是慢查主因之一


def _is_query_canceled(e: OperationalError) -> bool:
    orig = e.orig if e.orig is not None else e
    return "QueryCanceled" in type(orig).__name__ or "canceling statement" in str(e)


def _set_bitmap_io(db) -> None:
    """关键词查询会话调优，仅当前事务生效：
    提高位图堆扫描预取并发（默认 1 = 冷缓存随机读串行）；
    关闭并行查询（2GB 机上并行收益小，且 docker 默认 64MB /dev/shm
    会被并行动态共享内存打爆报 DiskFull）。"""
    try:
        db.execute(sa_text(f"SET LOCAL effective_io_concurrency = {BITMAP_IO_CONCURRENCY}"))
        db.execute(sa_text("SET LOCAL max_parallel_workers_per_gather = 0"))
    except Exception:  # noqa: BLE001  平台不支持时不影响查询
        pass


def _keyword_tiered_items(db, q_nokw, keyword: str, order_keys, page: int, page_size: int):
    """关键词搜索的相关性分层取数：岗位名命中 > 单位名命中 > 其他字段命中。

    每层是无 CASE 排序的独立查询：正向命中走 bigram/trgm 位图或 (year,id) 提前终止，
    负向排除用纯 ILIKE（IS NOT TRUE 把 NULL 归入非命中层，与 CASE else 语义一致）。
    前两层凑满窗口则不执行 tier3；tier3 带语句级超时，超时降级为仅标题/单位命中。
    返回 (id 列表, tier3_timed_out)。"""
    _set_bitmap_io(db)
    pos_ilike = _hit_clause(Position.position_example, keyword)
    emp_ilike = _hit_clause(Position.employer, keyword)
    tiers = [
        q_nokw.filter(_bigram_hit_clause(Position.position_example, keyword)),
        q_nokw.filter(pos_ilike.is_not(True), _bigram_hit_clause(Position.employer, keyword)),
    ]
    end = page * page_size
    collected: List[int] = []
    for tier_q in tiers:
        remaining = end - len(collected)
        if remaining <= 0:
            break
        collected.extend(p.id for p in tier_q.order_by(*order_keys).limit(remaining).all())
    timed_out = False
    remaining = end - len(collected)
    if remaining > 0:
        tier3 = q_nokw.filter(
            _bigram_hit_clause(Position.search_text, keyword),
            pos_ilike.is_not(True),
            emp_ilike.is_not(True),
        )
        try:
            db.execute(sa_text(f"SET LOCAL statement_timeout = '{TIER3_TIMEOUT_MS}'"))
            collected.extend(p.id for p in tier3.order_by(*order_keys).limit(remaining).all())
            db.execute(sa_text("SET LOCAL statement_timeout = DEFAULT"))
        except OperationalError as e:
            if not _is_query_canceled(e):
                raise
            db.rollback()
            timed_out = True
    return collected[(page - 1) * page_size : end], timed_out


def _major_columns(model, major_type: str):
    cols = [model.undergrad_major, model.grad_major, model.raw_major]
    if major_type == "undergrad":
        cols = [model.undergrad_major, model.raw_major]
    elif major_type == "grad":
        cols = [model.grad_major, model.raw_major]
    return cols


def _distinct_column_values(db, model, col_name: str) -> List[str]:
    """清洗行上某列的全部去重取值（Redis 缓存 24h），用于把关键词类筛选转成 IN 列表。"""
    key = f"colvals:{model.__tablename__}:{col_name}"

    def load():
        col = getattr(model, col_name)
        rows = db.query(col).filter(col != None, col != "").distinct().limit(2000).all()  # noqa: E711
        return [r[0] for r in rows if r[0]]

    return cache.get_or_set(key, 86400, load)


def _category_value_lists(db, model, categories: List[str]):
    """把类别筛选映射为 job_type/exam_type 的取值列表（走 IN + 索引，避免全表 ILIKE）。"""
    kws: List[str] = []
    for cat in categories:
        kws.extend(CATEGORY_KEYWORDS.get(cat, [cat]))
    jt_all = _distinct_column_values(db, model, "job_type")
    et_all = _distinct_column_values(db, model, "exam_type")
    jt_vals = [v for v in jt_all if any(kw in v for kw in kws)]
    et_vals = [v for v in et_all if any(kw in v for kw in kws)]
    return jt_vals, et_vals


def _apply_filters(query, model, filters: PositionFilter):
    if filters.year:
        query = query.filter(model.year.in_(filters.year))
    if filters.job_type:
        query = query.filter(model.job_type.in_(filters.job_type))
    if filters.exam_type:
        query = query.filter(model.exam_type.in_(filters.exam_type))
    if filters.exam_type_norm and hasattr(model, "exam_type_norm"):
        query = query.filter(model.exam_type_norm.in_(filters.exam_type_norm))
    if filters.province and hasattr(model, "province"):
        query = query.filter(model.province.in_(filters.province))
    if filters.edu_requirement:
        query = query.filter(model.edu_requirement.in_(filters.edu_requirement))
    if filters.edu_level:
        query = query.filter(model.edu_level_norm.in_(filters.edu_level))
    if filters.work_location:
        query = query.filter(model.work_location.in_(filters.work_location))

    if filters.location:
        tags = [t for t in filters.location if t]
        if tags:
            query = query.filter(model.location_tags.overlap(tags))

    if filters.major:
        k = f"%{filters.major}%"
        major_cols = _major_columns(model, filters.major_type or "any")
        query = query.filter(or_(*(col.ilike(k) for col in major_cols if col is not None)))

    if filters.category:
        jt_vals, et_vals = _category_value_lists(query.session, model, filters.category)
        cat_clauses = []
        if jt_vals:
            cat_clauses.append(model.job_type.in_(jt_vals))
        if et_vals:
            cat_clauses.append(model.exam_type.in_(et_vals))
        if cat_clauses:
            query = query.filter(or_(*cat_clauses))
        else:
            query = query.filter(model.id.is_(None))

    if filters.hide_expired and hasattr(model, "signup_deadline"):
        query = query.filter(or_(
            model.signup_deadline == None,  # noqa: E711
            model.signup_deadline >= datetime.now(),
        ))

    if filters.keyword:
        variants = keyword_variants(filters.keyword)
        if hasattr(model, "search_text"):
            # bigram GIN 预过滤 + ILIKE 精校（2 字词 trgm 覆盖不到，结果集不变）
            query = query.filter(_bigram_hit_clause(model.search_text, filters.keyword))
        else:
            clauses = []
            for v in variants:
                k = f"%{v}%"
                clauses.extend([
                    model.position_example.ilike(k),
                    model.employer.ilike(k),
                    model.undergrad_major.ilike(k),
                    model.grad_major.ilike(k),
                    model.raw_major.ilike(k),
                    model.special_requirements.ilike(k),
                    model.exam_type.ilike(k),
                    model.work_location.ilike(k),
                    model.job_type.ilike(k),
                    model.notes.ilike(k),
                ])
            query = query.filter(or_(*clauses))
    return query


COUNT_CAP = 10001


def _capped_count(q) -> int:
    """封顶计数：子查询 LIMIT COUNT_CAP 后 count，大结果集避免全量精确计数。
    返回值达到 COUNT_CAP 表示实际总数 >= COUNT_CAP。"""
    return q.order_by(None).limit(COUNT_CAP).count() or 0


def _cache_get_json(key: str):
    try:
        raw = cache.get_redis().get(key)
        return json.loads(raw) if raw is not None else None
    except Exception:  # noqa: BLE001  Redis 不可用时直接回源
        return None


def _cache_set_json(key: str, ttl: int, value) -> None:
    try:
        cache.get_redis().setex(key, ttl, json.dumps(value))
    except Exception:  # noqa: BLE001
        pass


def _nokw_base_query(db, filters: PositionFilter):
    """清洗行基础查询 + 除关键词外的全部筛选（供 count 竞速/后台补算在独立会话中重建）。"""
    nokw = PositionFilter(**{**filters.model_dump(), "keyword": None})
    q = db.query(Position).filter(
        Position.dup_of_id.is_(None), Position.invalid_reason.is_(None)
    ).options(defer(Position.search_text))
    return _apply_filters(q, Position, nokw)


def _count_race_worker(filters: PositionFilter, keyword: str, use_bigram: bool, state: dict, cv: "threading.Condition"):
    db = SessionLocal()
    n = None
    timeout_ms = COUNT_BIGRAM_TIMEOUT_MS if use_bigram else COUNT_ILIKE_TIMEOUT_MS
    try:
        db.execute(sa_text(f"SET statement_timeout = '{timeout_ms}'"))
        _set_bitmap_io(db)
        q = _nokw_base_query(db, filters)
        clause = (
            _bigram_hit_clause(Position.search_text, keyword)
            if use_bigram
            else _hit_clause(Position.search_text, keyword)
        )
        n = _capped_count(q.filter(clause))
    except Exception:  # noqa: BLE001  超时/资源不足视为该路失败，由另一路或降级兜底
        pass
    finally:
        db.close()
        with cv:
            if n is not None and state["result"] is None:
                state["result"] = n
            state["finished"] += 1
            cv.notify_all()


def _keyword_capped_count(db, q_nokw, keyword: str, filters: PositionFilter):
    """关键词 count：bigram 版与纯 ILIKE 版双路竞速，先完成者胜，返回 (count, partial)。

    两路互补且互为对方的坏情形（planner 估计不可靠，不能靠它选路）：
    低频/中频词 bigram 位图候选集小（冷查 ~0.6s），但高频词位图构建要读大段 GIN 索引（>10s）；
    高频词纯 ILIKE 顺扫 LIMIT 10001 提前触顶（冷查 ~0.5-0.9s），但中频词扫全表（~4s）。
    各带语句级超时并行执行，先成功者返回；bigram 路超时更短，
    输掉时早停释放磁盘 IO，避免拖慢另一路（冷缓存下两路抢同一块盘）；
    双路都失败才降级为仅标题/单位命中计数（partial=True，不入缓存），
    并由调用方后台补算精确值写入缓存，前端重试即可拿到精确 total。"""
    cv = threading.Condition()
    state: dict = {"result": None, "finished": 0}
    for ub in (True, False):
        threading.Thread(
            target=_count_race_worker, args=(filters, keyword, ub, state, cv), daemon=True
        ).start()
    deadline = COUNT_ILIKE_TIMEOUT_MS / 1000 + 1.5
    with cv:
        cv.wait_for(lambda: state["result"] is not None or state["finished"] >= 2, timeout=deadline)
        if state["result"] is not None:
            return state["result"], False
    # 双路失败：降级为仅标题/单位命中计数（走小 bigram 索引，毫秒级）
    _set_bitmap_io(db)
    degraded_q = q_nokw.filter(
        or_(
            _bigram_hit_clause(Position.position_example, keyword),
            _bigram_hit_clause(Position.employer, keyword),
        )
    )
    try:
        return _capped_count(degraded_q), True
    except OperationalError as e:
        if not _is_query_canceled(e):
            raise
        db.rollback()
        return 0, True


def _refresh_exact_count_async(filters: PositionFilter) -> None:
    """count 降级后后台补算精确 capped count 并写入缓存（redis 锁防并发重算），
    前端「点击重试」或下一次请求命中缓存即可拿到精确 total。"""
    count_key = "cnt:pos:" + filters.model_dump_json()
    lock_key = "lock:" + count_key
    try:
        if not cache.get_redis().set(lock_key, "1", nx=True, ex=120):
            return
    except Exception:  # noqa: BLE001  Redis 不可用时不补算
        return

    def run():
        db = SessionLocal()
        try:
            db.execute(sa_text("SET statement_timeout = '30s'"))
            _set_bitmap_io(db)
            # 纯 ILIKE 版：高频词 LIMIT 触顶快、中低频词全表顺扫有上界（~几秒），
            # bigram 版对高频词要读大段 GIN 索引，30s 内未必能完成
            q = _nokw_base_query(db, filters)
            n = _capped_count(q.filter(_hit_clause(Position.search_text, filters.keyword)))
            _cache_set_json(count_key, 1800, n)
        except Exception:  # noqa: BLE001  补算失败不影响主链路
            pass
        finally:
            db.close()
            try:
                cache.get_redis().delete(lock_key)
            except Exception:  # noqa: BLE001
                pass

    threading.Thread(target=run, daemon=True).start()


def search_positions(
    db: Session,
    filters: PositionFilter,
    page: int = 1,
    page_size: int = 20,
    sort: str = "year_desc",
    meta: Optional[dict] = None,
):
    """meta（可选 dict）：tier3 超时写 timed_out=True（列表不完整），
    count 超时写 total_partial=True（total 为「至少 N 条」部分值），两者均不入缓存。"""
    q = db.query(Position).filter(Position.dup_of_id.is_(None), Position.invalid_reason.is_(None)).options(defer(Position.search_text))
    q = _apply_filters(q, Position, filters)
    # 类别筛选是高选择性条件：用 year+0 阻止 planner 走全量 (year,id) 有序索引扫描，
    # 改走 job_type/exam_type 位图索引后再排序
    year_col = (Position.year + 0) if filters.category else Position.year
    if sort == "year_desc":
        order_keys = [year_col.desc(), Position.id.desc()]
    elif sort == "year_asc":
        order_keys = [year_col.asc(), Position.id.asc()]
    else:
        order_keys = [(Position.id + 0).desc() if filters.category else Position.id.desc()]
    count_key = "cnt:pos:" + filters.model_dump_json()
    timed_out = False
    if filters.keyword:
        # 相关性分层取数代替 CASE 排序，避免同义 OR 首查全表扫描；
        # id 列表入缓存（与 count 同寿命，预热任务会延长热词 TTL）
        nokw = PositionFilter(**{**filters.model_dump(), "keyword": None})
        q_nokw = db.query(Position).filter(
            Position.dup_of_id.is_(None), Position.invalid_reason.is_(None)
        ).options(defer(Position.search_text))
        q_nokw = _apply_filters(q_nokw, Position, nokw)
        total = _cache_get_json(count_key)
        if total is None:
            total, count_partial = _keyword_capped_count(db, q_nokw, filters.keyword, filters)
            if count_partial:
                # 降级计数不入缓存；后台补算精确值，重试/下次请求命中缓存即精确
                _refresh_exact_count_async(filters)
                if meta is not None:
                    meta["total_partial"] = True
            else:
                _cache_set_json(count_key, 1800, total)
        items_key = f"items:pos:{sort}:{page}:{page_size}:" + filters.model_dump_json()
        ids = _cache_get_json(items_key)
        if ids is None:
            ids, tier3_to = _keyword_tiered_items(
                db, q_nokw, filters.keyword, order_keys, page, page_size
            )
            if not tier3_to:
                _cache_set_json(items_key, 1800, ids)
            timed_out = timed_out or tier3_to
        items = _positions_by_ids(db, ids)
    else:
        total = cache.get_or_set(count_key, 1800, lambda: _capped_count(q))
        items = q.order_by(*order_keys).offset((page - 1) * page_size).limit(page_size).all()
    if meta is not None and timed_out:
        meta["timed_out"] = True
    return total, items


def _positions_by_ids(db: Session, ids: List[int]) -> List[Position]:
    if not ids:
        return []
    rows = (
        db.query(Position)
        .filter(Position.id.in_(ids))
        .options(defer(Position.search_text))
        .all()
    )
    by_id = {p.id: p for p in rows}
    return [by_id[i] for i in ids if i in by_id]


def get_position(db: Session, position_id: int):
    return (
        db.query(Position)
        .filter(Position.id == position_id)
        .options(defer(Position.search_text))
        .first()
    )


def search_positions_cursor(
    db: Session,
    filters: PositionFilter,
    after_id: int,
    after_year: Optional[int] = None,
    page_size: int = 100,
    sort: str = "year_desc",
):
    q = db.query(Position).filter(Position.dup_of_id.is_(None), Position.invalid_reason.is_(None)).options(defer(Position.search_text))
    q = _apply_filters(q, Position, filters)
    year_col = (Position.year + 0) if filters.category else Position.year
    if sort == "year_desc" and after_year is not None:
        q = q.filter(
            or_(
                Position.year < after_year,
                (Position.year == after_year) & (Position.id < after_id),
            )
        ).order_by(year_col.desc(), Position.id.desc())
    elif sort == "year_asc" and after_year is not None:
        q = q.filter(
            or_(
                Position.year > after_year,
                (Position.year == after_year) & (Position.id > after_id),
            )
        ).order_by(year_col.asc(), Position.id.asc())
    else:
        q = q.filter(Position.id < after_id).order_by((Position.id + 0).desc() if filters.category else Position.id.desc())
    return q.limit(page_size).all()


def upcoming_deadlines(db: Session, days: int = 7, limit: int = 50):
    """即将截止的岗位：signup_deadline 在 [now, now+days] 内，按截止时间升序。"""
    now = datetime.now()
    return (
        db.query(Position)
        .filter(
            Position.dup_of_id.is_(None), Position.invalid_reason.is_(None),
            Position.signup_deadline != None,
            Position.signup_deadline >= now,
            Position.signup_deadline <= now + timedelta(days=days),
        )
        .options(defer(Position.search_text))
        .order_by(Position.signup_deadline.asc(), Position.id.asc())
        .limit(limit)
        .all()
    )


def search_sources(db: Session, filters: PositionFilter, page: int = 1, page_size: int = 20):
    q = db.query(Source)
    q = _apply_filters(q, Source, filters)
    q = q.order_by(Source.year.desc(), Source.id.desc())
    count_key = "cnt:src:" + filters.model_dump_json()
    total = cache.get_or_set(count_key, 1800, lambda: _capped_count(q))
    items = q.offset((page - 1) * page_size).limit(page_size).all()
    return total, items


def get_filter_options(db: Session, limit: int = 120):
    clean = [Position.dup_of_id.is_(None), Position.invalid_reason.is_(None)]

    def distinct_values(col, l=limit):
        rows = (
            db.query(col)
            .filter(*clean, col != None, col != "")
            .distinct()
            .order_by(col)
            .limit(l)
            .all()
        )
        return [r[0] for r in rows if r[0]]

    years = [r[0] for r in db.query(Position.year)
             .filter(*clean, Position.year != None)
             .distinct()
             .order_by(Position.year.desc())
             .all()]

    edu_levels = (
        db.query(Position.edu_level_norm)
        .filter(*clean, Position.edu_level_norm != None, Position.edu_level_norm != "")
        .distinct()
        .order_by(Position.edu_level_norm)
        .limit(limit)
        .all()
    )
    edu_levels = [r[0] for r in edu_levels if r[0]]

    # 热门城市：从 location_tags 中计数，过滤掉省级名称，保留城市级
    city_counter: Counter = Counter()
    province_set = set(ALL_PROVINCES)
    rows = db.query(Position.location_tags).filter(*clean, Position.location_tags != None).limit(200000).all()
    for (tags,) in rows:
        for tag in (tags or []):
            if tag and tag not in province_set and len(tag) >= 2 and not tag.startswith("("):
                city_counter[tag] += 1
    hot_locations = [k for k, _ in city_counter.most_common(80)]

    # 常用区县：从 location_tags 中排除已知的省/市
    city_set = set(ALL_CITIES)
    district_counter: Counter = Counter()
    for (tags,) in rows:
        for tag in (tags or []):
            if tag and tag not in province_set and tag not in city_set and len(tag) >= 2:
                district_counter[tag] += 1
    districts = [k for k, _ in district_counter.most_common(200)]

    # 区县层级树：省→市→区县（来自结构化 province/city/district 列）
    dist_rows = (
        db.query(Position.province, Position.city, Position.district)
        .filter(*clean, Position.district != None, Position.district != "",  # noqa: E711
                Position.province != None, Position.city != None)  # noqa: E711
        .distinct()
        .all()
    )
    def _norm_district(prov: str, city: str, dist: str):
        d = dist.strip()
        for pre in (f"{prov}省", f"{prov}市", f"{prov}自治区", prov):
            if d.startswith(pre):
                d = d[len(pre):]
                break
        for pre in (f"{city}市", f"{city}州", city):
            if d.startswith(pre):
                d = d[len(pre):]
                break
        d = d.strip()
        if len(d) < 2 or d == "辖区" or "省" in d:
            return None
        return d

    dt_map: dict = {}
    for prov, city, dist in dist_rows:
        d = _norm_district(prov, city, dist)
        if d:
            dt_map.setdefault((prov, city), set()).add(d)
    district_tree = [
        {"province": p, "city": c, "districts": sorted(ds)}
        for (p, c), ds in sorted(dt_map.items())
    ]

    return {
        "years": years,
        "job_types": distinct_values(Position.job_type),
        "edu_requirements": edu_levels,
        "work_locations": distinct_values(Position.work_location),
        "exam_types": distinct_values(Position.exam_type),
        "edu_levels": edu_levels,
        "categories": list(CATEGORY_KEYWORDS.keys()),
        "provinces": ALL_PROVINCES,
        "location_tree": location_tree(),
        "hot_locations": hot_locations,
        "districts": districts,
        "exam_type_norms": distinct_values(Position.exam_type_norm),
        "district_tree": district_tree,
    }


_TOKEN_SPLIT_RE = re.compile(r"[\s,，、；;。．.:：/（）()\[\]【】\-—－|｜*＊·\"'“”]+")

_CLEAN_FILTERS = (Position.dup_of_id.is_(None), Position.invalid_reason.is_(None))


def suggest_keywords(db: Session, q: str, limit: int = 10, sample: int = 500) -> List[Dict]:
    """关键词补全：利用 search_text 的 GIN trigram 索引取样含 q 的行，
    再从 position_example/employer/exam_type 中切词统计包含 q 的高频词。"""
    q = (q or "").strip()
    if not q:
        return []
    rows = (
        db.query(Position.position_example, Position.employer, Position.exam_type)
        .filter(*_CLEAN_FILTERS, Position.search_text.ilike(f"%{q}%"))
        .limit(sample)
        .all()
    )
    counter: Counter = Counter()
    ql = q.lower()
    for row in rows:
        for field in row:
            if not field:
                continue
            for tok in _TOKEN_SPLIT_RE.split(field):
                tok = tok.strip()
                if 2 <= len(tok) <= 20 and ql in tok.lower():
                    counter[tok] += 1
    return [{"word": w, "count": c} for w, c in counter.most_common(limit)]


def recommend_positions(
    db: Session,
    major: str,
    filters: PositionFilter,
    limit: int = 50,
):
    """专业智能推荐：把专业关键词扩展为同大类相关专业，
    命中原词 > 同大类专业 > 专业不限，返回打分排序的岗位。"""
    terms = expand_major(major)
    if not terms:
        return [], []
    major_cols = [Position.undergrad_major, Position.grad_major, Position.raw_major]

    def any_match(term: str):
        k = f"%{term}%"
        return or_(*(col.ilike(k) for col in major_cols))

    unrestricted = or_(*(col.ilike("%不限%") for col in major_cols))
    related = terms[1:]
    match_filters = PositionFilter(**{**filters.model_dump(), "major": None, "keyword": None})

    def base_query(cond):
        q = (
            db.query(Position)
            .filter(Position.dup_of_id.is_(None), Position.invalid_reason.is_(None))
            .filter(cond)
            .options(defer(Position.search_text))
        )
        return _apply_filters(q, Position, match_filters)

    # 分层查询各自 LIMIT 提前终止，避免单条全表 ILIKE + 排序超时
    tiers = [(any_match(terms[0]), 3)]
    if related:
        tiers.append((or_(*(any_match(t) for t in related)), 2))
    tiers.append((unrestricted, 1))

    rows = []
    seen = set()
    for cond, tier_score in tiers:
        if len(rows) >= limit:
            break
        for pos in (
            base_query(cond)
            .order_by(Position.year.desc(), Position.id.desc())
            .limit(limit - len(rows) + len(seen))
        ):
            if pos.id in seen:
                continue
            seen.add(pos.id)
            rows.append((pos, tier_score))
            if len(rows) >= limit:
                break
    items = []
    for pos, s in rows:
        pos.match_score = s
        items.append(pos)
    return items, terms


EXPORT_COLUMNS = [
    ("id", "ID"),
    ("year", "年份"),
    ("job_type", "工作类型"),
    ("exam_type", "考试/招聘类型"),
    ("employer", "招聘单位"),
    ("position_example", "岗位"),
    ("edu_requirement", "学历要求"),
    ("edu_level_norm", "学历层级"),
    ("undergrad_major", "本科专业"),
    ("grad_major", "研究生专业"),
    ("work_location", "工作地点"),
    ("province", "省份"),
    ("city", "城市"),
    ("exam_form", "考试形式"),
    ("signup_time", "报名时间"),
    ("signup_deadline", "报名截止"),
    ("exam_time", "考试时间"),
    ("special_requirements", "特殊要求"),
    ("source_url", "来源链接"),
]


def export_positions(db: Session, filters: PositionFilter, sort: str = "year_desc", max_rows: int = 20000):
    """导出查询：返回最多 max_rows 条匹配当前筛选的岗位。"""
    q = db.query(Position).filter(Position.dup_of_id.is_(None), Position.invalid_reason.is_(None)).options(defer(Position.search_text))
    q = _apply_filters(q, Position, filters)
    if sort == "year_asc":
        q = q.order_by(Position.year.asc(), Position.id.asc())
    else:
        q = q.order_by(Position.year.desc(), Position.id.desc())
    return q.limit(max_rows).yield_per(1000)


def get_stats(db: Session, top_n: int = 20) -> Dict:
    """整体统计：总量、按年份/工作类型/省份/学历/考试类别分布、热门岗位关键词。"""
    def group_count(col, limit_n=None, order_by_key=False):
        query = (
            db.query(col, func.count().label("c"))
            .filter(*_CLEAN_FILTERS, col != None)
            .group_by(col)
        )
        query = query.order_by(col.desc() if order_by_key else func.count().desc())
        if limit_n:
            query = query.limit(limit_n)
        return [{"name": str(k), "count": c} for k, c in query.all()]

    total = db.query(func.count(Position.id)).filter(*_CLEAN_FILTERS).scalar() or 0

    hot_counter: Counter = Counter()
    rows = (
        db.query(Position.position_example, func.count().label("c"))
        .filter(*_CLEAN_FILTERS, Position.position_example != None, Position.position_example != "")
        .group_by(Position.position_example)
        .order_by(func.count().desc())
        .limit(top_n * 10)
        .all()
    )
    for name, c in rows:
        for tok in _TOKEN_SPLIT_RE.split(name):
            tok = tok.strip()
            if 2 <= len(tok) <= 10:
                hot_counter[tok] += c

    return {
        "total": total,
        "by_year": group_count(Position.year, order_by_key=True),
        "by_job_type": group_count(Position.job_type),
        "by_province": group_count(Position.province),
        "by_edu_level": group_count(Position.edu_level_norm),
        "by_exam_type": group_count(Position.exam_type_norm, limit_n=top_n),
        "hot_keywords": [{"word": w, "count": c} for w, c in hot_counter.most_common(top_n)],
    }
