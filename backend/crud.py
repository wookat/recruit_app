import re
from collections import Counter
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from pydantic import BaseModel
from sqlalchemy import or_, func
from sqlalchemy.orm import Session, defer

import cache
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


def _major_columns(model, major_type: str):
    cols = [model.undergrad_major, model.grad_major, model.raw_major]
    if major_type == "undergrad":
        cols = [model.undergrad_major, model.raw_major]
    elif major_type == "grad":
        cols = [model.grad_major, model.raw_major]
    return cols


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
        cat_clauses = []
        for cat in filters.category:
            kws = CATEGORY_KEYWORDS.get(cat, [cat])
            for kw in kws:
                cat_clauses.append(model.job_type.ilike(f"%{kw}%"))
                cat_clauses.append(model.exam_type.ilike(f"%{kw}%"))
        if cat_clauses:
            query = query.filter(or_(*cat_clauses))

    if filters.keyword:
        k = f"%{filters.keyword}%"
        if hasattr(model, "search_text"):
            query = query.filter(model.search_text.ilike(k))
        else:
            query = query.filter(or_(
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
            ))
    return query


COUNT_CAP = 10001


def _capped_count(q) -> int:
    """封顶计数：子查询 LIMIT COUNT_CAP 后 count，大结果集避免全量精确计数。
    返回值达到 COUNT_CAP 表示实际总数 >= COUNT_CAP。"""
    return q.order_by(None).limit(COUNT_CAP).count() or 0


def search_positions(db: Session, filters: PositionFilter, page: int = 1, page_size: int = 20, sort: str = "year_desc"):
    q = db.query(Position).filter(Position.dup_of_id.is_(None), Position.invalid_reason.is_(None)).options(defer(Position.search_text))
    q = _apply_filters(q, Position, filters)
    if sort == "year_desc":
        q = q.order_by(Position.year.desc(), Position.id.desc())
    elif sort == "year_asc":
        q = q.order_by(Position.year.asc(), Position.id.asc())
    else:
        q = q.order_by(Position.id.desc())
    count_key = "cnt:pos:" + filters.model_dump_json()
    total = cache.get_or_set(count_key, 1800, lambda: _capped_count(q))
    items = q.offset((page - 1) * page_size).limit(page_size).all()
    return total, items


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
    if sort == "year_desc" and after_year is not None:
        q = q.filter(
            or_(
                Position.year < after_year,
                (Position.year == after_year) & (Position.id < after_id),
            )
        ).order_by(Position.year.desc(), Position.id.desc())
    elif sort == "year_asc" and after_year is not None:
        q = q.filter(
            or_(
                Position.year > after_year,
                (Position.year == after_year) & (Position.id > after_id),
            )
        ).order_by(Position.year.asc(), Position.id.asc())
    else:
        q = q.filter(Position.id < after_id).order_by(Position.id.desc())
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
