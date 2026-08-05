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
    work_location: Optional[str] = None
    deadline_date: Optional[date] = None
    announce_url: Optional[str] = None
    apply_url: Optional[str] = None
    industry: Optional[str] = None
    grad_years: Optional[str] = None
    created_at: Optional[datetime] = None


class UnifiedJobList(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[UnifiedJobOut]


COLUMNS = (
    "source_board, source_id, title, employer, category, edu_level_norm, major, "
    "province, city, work_location, deadline_date, announce_url, apply_url, "
    "industry, grad_years, created_at"
)


def _build_where(
    keyword, board, province, city, edu, due_within_days,
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
        clauses.append("(city = ANY(:cities) OR work_location ILIKE ANY(:city_pats))")
        params["cities"] = list(city)
        params["city_pats"] = [f"%{c}%" for c in city]
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
    edu: Optional[List[str]] = Query(None),
    due_within_days: Optional[int] = Query(None, ge=0, le=365),
    deadline_from: Optional[date] = None,
    deadline_to: Optional[date] = None,
    hide_expired: bool = False,
    sort: str = Query("created_desc", pattern="^(created_desc|deadline_asc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    where, params = _build_where(
        keyword, board, province, city, edu, due_within_days,
        deadline_from, deadline_to, hide_expired,
    )
    total = db.execute(
        text(f"SELECT count(*) FROM unified_jobs{where}"), params
    ).scalar() or 0
    if sort == "deadline_asc":
        order = "ORDER BY deadline_date ASC NULLS LAST, created_at DESC, source_board, source_id DESC"
    else:
        order = "ORDER BY created_at DESC NULLS LAST, source_board, source_id DESC"
    rows = db.execute(
        text(
            f"SELECT {COLUMNS} FROM unified_jobs{where} {order} "
            "LIMIT :limit OFFSET :offset"
        ),
        {**params, "limit": page_size, "offset": (page - 1) * page_size},
    ).mappings().all()
    return {
        "total": total,
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
        "edu_levels": {e: n for e, n in edus},
    }
