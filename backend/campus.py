"""校招/社招信息 API：/api/campus 列表与筛选项。"""
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

import cache
from database import get_db
from models import CampusJob

router = APIRouter(prefix="/api/campus", tags=["campus"])


class CampusJobOut(BaseModel):
    id: int
    source_table: Optional[str] = None
    company: Optional[str] = None
    positions: Optional[str] = None
    company_type: Optional[str] = None
    industry: Optional[str] = None
    batch: Optional[str] = None
    grad_years: Optional[str] = None
    no_exam: Optional[str] = None
    edu_requirement: Optional[str] = None
    major_requirement: Optional[str] = None
    locations: Optional[str] = None
    start_date: Optional[str] = None
    deadline_text: Optional[str] = None
    deadline_date: Optional[date] = None
    announce_url: Optional[str] = None
    apply_url: Optional[str] = None
    referral_code: Optional[str] = None
    notes: Optional[str] = None
    updated_at_src: Optional[str] = None

    model_config = {"from_attributes": True}


class CampusList(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[CampusJobOut]


@router.get("", response_model=CampusList)
def list_campus_jobs(
    keyword: Optional[str] = None,
    source_table: Optional[List[str]] = Query(None),
    company_type: Optional[List[str]] = Query(None),
    industry: Optional[List[str]] = Query(None),
    batch: Optional[str] = None,
    grad_year: Optional[str] = None,
    no_exam_only: bool = False,
    referral_only: bool = False,
    location: Optional[str] = None,
    updated_after: Optional[str] = None,
    due_within_days: Optional[int] = Query(None, ge=0, le=365),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    q = db.query(CampusJob)
    if source_table:
        q = q.filter(CampusJob.source_table.in_(source_table))
    if company_type:
        q = q.filter(CampusJob.company_type.in_(company_type))
    if industry:
        q = q.filter(or_(*(CampusJob.industry.ilike(f"%{i}%") for i in industry)))
    if batch:
        q = q.filter(CampusJob.batch.ilike(f"%{batch}%"))
    if grad_year:
        q = q.filter(CampusJob.grad_years.ilike(f"%{grad_year}%"))
    if no_exam_only:
        q = q.filter(or_(CampusJob.no_exam.ilike("%免笔试%"), CampusJob.no_exam == "/"))
    if referral_only:
        q = q.filter(CampusJob.referral_code != None, CampusJob.referral_code != "")  # noqa: E711
    if location:
        q = q.filter(CampusJob.locations.ilike(f"%{location}%"))
    if updated_after:
        q = q.filter(CampusJob.updated_at_src >= updated_after)
    if keyword:
        k = f"%{keyword}%"
        q = q.filter(or_(
            CampusJob.company.ilike(k),
            CampusJob.positions.ilike(k),
            CampusJob.industry.ilike(k),
            CampusJob.major_requirement.ilike(k),
        ))
    if due_within_days is not None:
        today = date.today()
        q = q.filter(CampusJob.deadline_date >= today,
                     CampusJob.deadline_date <= today + timedelta(days=due_within_days))
    total = q.count()
    order_by = (
        (CampusJob.deadline_date.asc(), CampusJob.id.desc())
        if due_within_days is not None
        else (CampusJob.updated_at_src.desc().nullslast(), CampusJob.id.desc())
    )
    items = (
        q.order_by(*order_by)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.get("/filters")
@cache.cached("campus_filters", ttl=86400)
def campus_filter_options(db: Session = Depends(get_db)):
    def distinct(col, limit=100):
        rows = (
            db.query(col, func.count().label("n"))
            .filter(col != None, col != "")  # noqa: E711
            .group_by(col)
            .order_by(func.count().desc())
            .limit(limit)
            .all()
        )
        return [r[0] for r in rows]

    tables = (
        db.query(CampusJob.source_table, func.count())
        .group_by(CampusJob.source_table)
        .all()
    )
    return {
        "source_tables": {t: n for t, n in tables},
        "company_types": distinct(CampusJob.company_type, 30),
        "industries": distinct(CampusJob.industry, 60),
        "batches": distinct(CampusJob.batch, 30),
        "grad_years": distinct(CampusJob.grad_years, 30),
    }
