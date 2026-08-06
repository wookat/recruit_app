"""热缓存预计算：主动刷新 /api/stats 与 /api/filters 的 Redis 缓存（长 TTL），
让用户请求永远命中热缓存，消除冷查询开销。

调用点：Celery beat 每日采集后 + pipeline.post_ingest 入库后。
"""
import json

import cache
import crud
from bianzhi import apply_bianzhi_filters, bianzhi_export_order
from campus import apply_campus_filters, campus_export_order
from database import SessionLocal
from models import BianzhiJob, CampusJob

HOT_TTL = 24 * 3600

# 与 @cache.cached 装饰器一致的 key（endpoint 无位置参数、无非 db 关键字参数）
STATS_KEY = cache._make_key("stats", (), {})
FILTERS_KEY = cache._make_key("filters", (), {})


def refresh_hot_caches() -> dict:
    """重算 stats 与 filters 并以 24h TTL 写入 Redis，返回结果摘要。"""
    db = SessionLocal()
    try:
        stats = crud.get_stats(db)
        filters = crud.get_filter_options(db)
    finally:
        db.close()
    r = cache.get_redis()
    r.setex(STATS_KEY, HOT_TTL, json.dumps(stats, default=str))
    r.setex(FILTERS_KEY, HOT_TTL, json.dumps(filters, default=str))
    return {"stats_total": stats.get("total"), "filters_keys": list(filters.keys())}


# 组合预热用的热门年份与工作类型
WARM_YEARS = (2027, 2026)
WARM_JOB_TYPES = ("公务员", "事业单位")
# 前端预设视图 chips 使用的类别筛选
WARM_CATEGORIES = ("公务员", "事业单位/事业编", "军队文职", "国企/央企", "选调生")


def _warm_count(db, r, filters: "crud.PositionFilter") -> None:
    """重算一个筛选组合的 count 与首页 items 缓存（key 与 crud 完全一致），并把 TTL 提到 24h。"""
    key = "cnt:pos:" + filters.model_dump_json()
    items_key = "items:pos:year_desc:1:20:" + filters.model_dump_json()
    r.delete(key, items_key)  # 先删再由 search_positions 内的 get_or_set 重算写入
    crud.search_positions(db, filters, page=1, page_size=20)
    r.expire(key, HOT_TTL)
    if filters.keyword:
        r.expire(items_key, HOT_TTL)


def warm_common_queries() -> dict:
    """预热最常用筛选组合的 count 缓存：无筛选、31 省单省、热门年份×工作类型。

    逐个执行（避免内存峰值），总查询数 <100；count 走 capped count（LIMIT 10001）。
    """
    combos = [crud.PositionFilter()]  # (a) 无筛选默认列表 page1
    combos += [crud.PositionFilter(province=[p]) for p in crud.ALL_PROVINCES]  # (b) 31 省
    for y in WARM_YEARS:  # (c) 热门年份 × 工作类型
        combos.append(crud.PositionFilter(year=[y]))
        for jt in WARM_JOB_TYPES:
            combos.append(crud.PositionFilter(year=[y], job_type=[jt]))
    for jt in WARM_JOB_TYPES:
        combos.append(crud.PositionFilter(job_type=[jt]))
    combos += [crud.PositionFilter(category=[c]) for c in WARM_CATEGORIES]  # (d) 预设视图 chips

    r = cache.get_redis()
    warmed, errors = 0, 0
    db = SessionLocal()
    try:
        for f in combos:
            try:
                _warm_count(db, r, f)
                warmed += 1
            except Exception:  # noqa: BLE001  单个组合失败不影响其余预热
                errors += 1
                db.rollback()
    finally:
        db.close()
    return {"warmed": warmed, "errors": errors, "combos": len(combos)}


def warm_board_caches() -> dict:
    """预热三板块 filters/counts/timeline 与统一列表默认首页缓存（冷路径根治）。

    直接调用带 @cache.cached 的 endpoint 函数：key 与线上请求一致；
    已有缓存则命中返回（幂等、代价极低），缓存被失效后则重算回填。
    调用点：app 启动、refresh_unified_jobs、各采集/enrich 任务失效缓存后。
    """
    import bianzhi
    import campus
    import jobs

    def _default_jobs_page(db):
        # 与前端首屏请求参数一致（UnifiedJobsPage PAGE_SIZE=50，其余默认值）
        return jobs.list_jobs(
            keyword=None, board=None, province=None, city=None, district=None,
            edu=None, due_within_days=None, deadline_from=None, deadline_to=None,
            hide_expired=False, sort="recommended", page=1, page_size=50, db=db,
        )

    targets = [
        ("jobs_filters", jobs.jobs_filter_options),
        ("jobs_default_page", _default_jobs_page),
        ("campus_filters", campus.campus_filter_options),
        ("campus_counts", campus.campus_counts),
        ("campus_timeline", campus.campus_timeline),
        ("bianzhi_filters", bianzhi.bianzhi_filter_options),
        ("bianzhi_counts", bianzhi.bianzhi_counts),
        ("bianzhi_timeline", bianzhi.bianzhi_timeline),
    ]
    warmed, errors = [], []
    db = SessionLocal()
    try:
        for name, fn in targets:
            try:
                fn(db=db)
                warmed.append(name)
            except Exception:  # noqa: BLE001  单项失败不影响其余预热
                errors.append(name)
                db.rollback()
    finally:
        db.close()
    return {"warmed": warmed, "errors": errors}


# 与前端 synonyms.ts 的 HOT_SEARCHES 词表 + expandKeyword 的同义组合保持一致
HOT_KEYWORDS = (
    "国考", "省考", "事业单位", "选调生", "教师",
    "护士", "银行", "央企", "国企", "三支一扶",
)
SYNONYM_COMBOS = (
    # 前端 SYNONYMS 全量扩展组合（原词在前，与 expandKeyword 输出一致）
    "研究生|硕士", "硕士|研究生", "大专|专科", "专科|大专",
    "老师|教师", "事业编|事业单位", "公务员|国考|省考",
)


def warm_suggest_vocab() -> dict:
    """预生成搜索联想的类别词表到 Redis（24h TTL）。"""
    db = SessionLocal()
    try:
        vocab = crud.build_suggest_vocab(db)
    finally:
        db.close()
    cache.get_redis().setex(
        crud.SUGGEST_VOCAB_KEY, HOT_TTL, json.dumps(vocab, ensure_ascii=False)
    )
    return {"vocab": len(vocab)}


def warm_hot_keywords() -> dict:
    """预热热门搜索词与常见同义组合（三板块）。

    positions 刷新 count 缓存（24h TTL）并执行分层首页查询；
    campus/bianzhi 列表接口无 Redis 缓存，直接执行同口径查询预热 PG 缓冲区。
    逐个执行，单词失败不影响其余。
    """
    keywords = list(HOT_KEYWORDS) + list(SYNONYM_COMBOS)
    r = cache.get_redis()
    warmed, errors = 0, 0
    db = SessionLocal()
    try:
        for kw in keywords:
            try:
                _warm_count(db, r, crud.PositionFilter(keyword=kw))
                q = apply_campus_filters(db.query(CampusJob), {"keyword": kw})
                q.count()
                q.order_by(*campus_export_order(None, kw)).limit(20).all()
                q = apply_bianzhi_filters(db.query(BianzhiJob), {"keyword": kw})
                q.count()
                q.order_by(*bianzhi_export_order(None, kw)).limit(20).all()
                warmed += 1
            except Exception:  # noqa: BLE001
                errors += 1
                db.rollback()
    finally:
        db.close()
    return {"warmed": warmed, "errors": errors, "keywords": len(keywords)}
