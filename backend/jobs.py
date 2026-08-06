"""统一岗位聚合 API：/api/jobs（体制内 + 校招 + 编制 合并列表，unified_jobs 物化视图）。"""
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

import cache
from database import get_db

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

BOARDS = ("体制内", "校招", "编制")
EDU_LEVELS = ("博士研究生", "硕士研究生", "本科", "大专/中专", "其他/不限")


class UnifiedJobOut(BaseModel):
    source_board: str
    source_id: int
    title: Optional[str] = None
    employer: Optional[str] = None
    category: Optional[str] = None
    edu_level_norm: Optional[str] = None
    major: Optional[str] = None
    province: Optional[str] = None
    city: Optional[str] = None
    district: Optional[str] = None
    work_location: Optional[str] = None
    deadline_date: Optional[date] = None
    announce_url: Optional[str] = None
    apply_url: Optional[str] = None
    industry: Optional[str] = None
    grad_years: Optional[str] = None
    created_at: Optional[datetime] = None


#: total 计数上限（与各板块 total_capped 约定一致，避免全表 count 拖慢列表接口）
COUNT_CAP = 100_000


class UnifiedJobList(BaseModel):
    total: int
    total_capped: bool = False
    page: int
    page_size: int
    items: List[UnifiedJobOut]


COLUMNS = (
    "source_board, source_id, title, employer, category, edu_level_norm, major, "
    "province, city, district, work_location, deadline_date, announce_url, apply_url, "
    "industry, grad_years, created_at"
)


def _build_where(
    keyword, board, province, city, district, edu, due_within_days,
    deadline_from, deadline_to, hide_expired,
):
    clauses = []
    params: dict = {}
    if keyword:
        clauses.append("search_text ILIKE :kw")
        params["kw"] = f"%{keyword.strip()}%"
    if board:
        clauses.append("source_board = ANY(:boards)")
        params["boards"] = [b for b in board if b in BOARDS]
    if province:
        clauses.append("province = ANY(:provinces)")
        params["provinces"] = list(province)
    if city:
        clauses.append("city = ANY(:cities)")
        params["cities"] = list(city)
    if district:
        clauses.append("district = ANY(:districts)")
        params["districts"] = list(district)
    if edu:
        clauses.append("edu_level_norm = ANY(:edus)")
        params["edus"] = list(edu)
    if due_within_days is not None:
        today = date.today()
        clauses.append("deadline_date >= :due_lo AND deadline_date <= :due_hi")
        params["due_lo"] = today
        params["due_hi"] = today + timedelta(days=due_within_days)
    if deadline_from:
        clauses.append("deadline_date >= :dl_from")
        params["dl_from"] = deadline_from
    if deadline_to:
        clauses.append("deadline_date <= :dl_to")
        params["dl_to"] = deadline_to
    if hide_expired:
        clauses.append("(deadline_date IS NULL OR deadline_date >= :today)")
        params["today"] = date.today()
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params


@router.get("", response_model=UnifiedJobList)
@cache.cached("jobs", ttl=300, stale=True)
def list_jobs(
    keyword: Optional[str] = None,
    board: Optional[List[str]] = Query(None),
    province: Optional[List[str]] = Query(None),
    city: Optional[List[str]] = Query(None),
    district: Optional[List[str]] = Query(None),
    edu: Optional[List[str]] = Query(None),
    due_within_days: Optional[int] = Query(None, ge=0, le=365),
    deadline_from: Optional[date] = None,
    deadline_to: Optional[date] = None,
    hide_expired: bool = False,
    sort: str = Query("recommended", pattern="^(recommended|created_desc|deadline_asc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    where, params = _build_where(
        keyword, board, province, city, district, edu, due_within_days,
        deadline_from, deadline_to, hide_expired,
    )
    total = db.execute(
        text(
            f"SELECT count(*) FROM (SELECT 1 FROM unified_jobs{where} LIMIT :cap) t"
        ),
        {**params, "cap": COUNT_CAP + 1},
    ).scalar() or 0
    total_capped = total > COUNT_CAP
    if total_capped:
        total = COUNT_CAP
    if sort == "deadline_asc":
        # 未截止在前（按截止升序），已截止沉底，无截止日期最后
        order = (
            "ORDER BY CASE WHEN deadline_date >= CURRENT_DATE THEN 0 "
            "WHEN deadline_date IS NOT NULL THEN 1 ELSE 2 END, "
            "deadline_date ASC NULLS LAST, created_at DESC, source_board, source_id DESC"
        )
    elif sort == "created_desc":
        order = "ORDER BY created_at DESC NULLS LAST, source_board, source_id DESC"
    else:
        # recommended：按收录日期倒序，同日内 体制内/编制 与 央国企/机关事业单位 类校招优先
        order = (
            "ORDER BY created_at::date DESC NULLS LAST, "
            "CASE WHEN source_board IN ('体制内', '编制') THEN 0 "
            "WHEN coalesce(category, '') ~ '(国有|国企|央企|机关|事业单位)' THEN 1 ELSE 2 END, "
            "created_at DESC, source_board, source_id DESC"
        )
    rows = db.execute(
        text(
            f"SELECT {COLUMNS} FROM unified_jobs{where} {order} "
            "LIMIT :limit OFFSET :offset"
        ),
        {**params, "limit": page_size, "offset": (page - 1) * page_size},
    ).mappings().all()
    return {
        "total": total,
        "total_capped": total_capped,
        "page": page,
        "page_size": page_size,
        "items": [UnifiedJobOut(**dict(r)).model_dump() for r in rows],
    }


@router.get("/filters")
@cache.cached("jobs_filters", ttl=86400, stale=True)
def jobs_filter_options(db: Session = Depends(get_db)):
    """板块/省份/学历计数（筛选项 + chips 计数，采集刷新后失效重算）。"""
    boards = db.execute(text(
        "SELECT source_board, count(*) FROM unified_jobs GROUP BY source_board"
    )).all()
    provinces = db.execute(text(
        """SELECT province, count(*) FROM unified_jobs
           WHERE province IS NOT NULL AND province <> ''
           GROUP BY province ORDER BY count(*) DESC LIMIT 40"""
    )).all()
    cities = db.execute(text(
        """SELECT city, province, count(*) FROM unified_jobs
           WHERE city IS NOT NULL AND city <> ''
           GROUP BY city, province ORDER BY count(*) DESC LIMIT 200"""
    )).all()
    edus = db.execute(text(
        "SELECT edu_level_norm, count(*) FROM unified_jobs GROUP BY edu_level_norm"
    )).all()
    districts = db.execute(text(
        """SELECT city, district, count(*) FROM unified_jobs
           WHERE district IS NOT NULL AND district <> ''
             AND city IS NOT NULL AND city <> ''
           GROUP BY city, district ORDER BY city, count(*) DESC"""
    )).all()
    city_districts: dict = {}
    for c, d, n in districts:
        city_districts.setdefault(c, {})[d] = n
    city_counts: dict = {}
    city_provinces: dict = {}
    for c, p, n in cities:
        city_counts[c] = city_counts.get(c, 0) + n
        if p and c not in city_provinces:
            city_provinces[c] = p
    return {
        "boards": {b: n for b, n in boards},
        "provinces": {p: n for p, n in provinces},
        "cities": city_counts,
        "city_provinces": city_provinces,
        "city_districts": city_districts,
        "edu_levels": {e: n for e, n in edus},
    }
