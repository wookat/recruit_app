"""编制类招聘公告 API：/api/bianzhi 列表与筛选项。"""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

import cache
from database import get_db
from models import BianzhiJob

router = APIRouter(prefix="/api/bianzhi", tags=["bianzhi"])


class BianzhiJobOut(BaseModel):
    id: int
    category: Optional[str] = None
    province: Optional[str] = None
    employer: Optional[str] = None
    headcount: Optional[str] = None
    job_type: Optional[str] = None
    work_location: Optional[str] = None
    edu_requirement: Optional[str] = None
    major_requirement: Optional[str] = None
    deadline_text: Optional[str] = None
    signup_start: Optional[str] = None
    exam_time: Optional[str] = None
    notes: Optional[str] = None
    announce_url: Optional[str] = None
    apply_url: Optional[str] = None
    updated_at_src: Optional[str] = None

    model_config = {"from_attributes": True}


class BianzhiList(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[BianzhiJobOut]


@router.get("", response_model=BianzhiList)
def list_bianzhi_jobs(
    keyword: Optional[str] = None,
    category: Optional[List[str]] = Query(None),
    province: Optional[List[str]] = Query(None),
    job_type: Optional[str] = None,
    edu: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    q = db.query(BianzhiJob)
    if category:
        q = q.filter(BianzhiJob.category.in_(category))
    if province:
        q = q.filter(BianzhiJob.province.in_(province))
    if job_type:
        q = q.filter(BianzhiJob.job_type.ilike(f"%{job_type}%"))
    if edu:
        q = q.filter(BianzhiJob.edu_requirement.ilike(f"%{edu}%"))
    if keyword:
        k = f"%{keyword}%"
        q = q.filter(or_(
            BianzhiJob.employer.ilike(k),
            BianzhiJob.work_location.ilike(k),
            BianzhiJob.major_requirement.ilike(k),
        ))
    total = q.count()
    items = (
        q.order_by(BianzhiJob.updated_at_src.desc().nullslast(), BianzhiJob.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.get("/filters")
@cache.cached("bianzhi_filters", ttl=86400)
def bianzhi_filter_options(db: Session = Depends(get_db)):
    cats = (
        db.query(BianzhiJob.category, func.count())
        .group_by(BianzhiJob.category)
        .all()
    )
    provinces = (
        db.query(BianzhiJob.province, func.count().label("n"))
        .filter(BianzhiJob.province != None, BianzhiJob.province != "")  # noqa: E711
        .group_by(BianzhiJob.province)
        .order_by(func.count().desc())
        .limit(50)
        .all()
    )
    return {
        "categories": {c: n for c, n in cats},
        "provinces": [p[0] for p in provinces],
    }
