from collections import Counter
from typing import Dict, List, Optional

from pydantic import BaseModel
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

from models import Position, Source
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


def search_positions(db: Session, filters: PositionFilter, page: int = 1, page_size: int = 20, sort: str = "year_desc"):
    q = db.query(Position).filter(Position.dup_of_id.is_(None), Position.invalid_reason.is_(None))
    q = _apply_filters(q, Position, filters)
    if sort == "year_desc":
        q = q.order_by(Position.year.desc(), Position.id.desc())
    elif sort == "year_asc":
        q = q.order_by(Position.year.asc(), Position.id.asc())
    else:
        q = q.order_by(Position.id.desc())
    total = q.count()
    items = q.offset((page - 1) * page_size).limit(page_size).all()
    return total, items


def search_sources(db: Session, filters: PositionFilter, page: int = 1, page_size: int = 20):
    q = db.query(Source)
    q = _apply_filters(q, Source, filters)
    q = q.order_by(Source.year.desc(), Source.id.desc())
    total = q.count()
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
