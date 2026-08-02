"""编制类招聘公告 API：/api/bianzhi 列表与筛选项。"""
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

import cache
import csv_export
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
    deadline_date: Optional[date] = None
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


#: 列表导出列（attr, 中文列名）
BIANZHI_EXPORT_COLUMNS = [
    ("employer", "招考单位"),
    ("category", "分类"),
    ("province", "省份"),
    ("job_type", "岗位类型"),
    ("headcount", "招聘人数"),
    ("work_location", "工作地点"),
    ("edu_requirement", "学历要求"),
    ("major_requirement", "专业要求"),
    ("signup_start", "报名开始"),
    ("deadline_text", "截止时间"),
    ("exam_time", "考试时间"),
    ("announce_url", "公告链接"),
    ("apply_url", "报名链接"),
    ("updated_at_src", "更新时间"),
]


def apply_bianzhi_filters(q, f: dict):
    """列表/导出共用的筛选链；f 为列表接口同名参数的 dict。"""
    if f.get("hide_expired"):
        q = q.filter(or_(BianzhiJob.deadline_date == None,  # noqa: E711
                         BianzhiJob.deadline_date >= date.today()))
    if f.get("category"):
        q = q.filter(BianzhiJob.category.in_(f["category"]))
    if f.get("province"):
        q = q.filter(BianzhiJob.province.in_(f["province"]))
    if f.get("job_type"):
        q = q.filter(BianzhiJob.job_type.ilike(f"%{f['job_type']}%"))
    if f.get("edu"):
        q = q.filter(BianzhiJob.edu_requirement.ilike(f"%{f['edu']}%"))
    if f.get("updated_after"):
        q = q.filter(BianzhiJob.updated_at_src >= f["updated_after"])
    if f.get("keyword"):
        k = f"%{f['keyword']}%"
        q = q.filter(or_(
            BianzhiJob.employer.ilike(k),
            BianzhiJob.work_location.ilike(k),
            BianzhiJob.major_requirement.ilike(k),
        ))
    if f.get("due_within_days") is not None:
        today = date.today()
        q = q.filter(BianzhiJob.deadline_date >= today,
                     BianzhiJob.deadline_date <= today + timedelta(days=f["due_within_days"]))
    return q


def bianzhi_export_order(due_within_days):
    return (
        (BianzhiJob.deadline_date.asc(), BianzhiJob.id.desc())
        if due_within_days is not None
        else (BianzhiJob.updated_at_src.desc().nullslast(), BianzhiJob.id.desc())
    )


@router.get("", response_model=BianzhiList)
def list_bianzhi_jobs(
    keyword: Optional[str] = None,
    category: Optional[List[str]] = Query(None),
    province: Optional[List[str]] = Query(None),
    job_type: Optional[str] = None,
    edu: Optional[str] = None,
    updated_after: Optional[str] = None,
    due_within_days: Optional[int] = Query(None, ge=0, le=365),
    hide_expired: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    q = apply_bianzhi_filters(db.query(BianzhiJob), {
        "keyword": keyword,
        "category": category,
        "province": province,
        "job_type": job_type,
        "edu": edu,
        "updated_after": updated_after,
        "due_within_days": due_within_days,
        "hide_expired": hide_expired,
    })
    total = q.count()
    items = (
        q.order_by(*bianzhi_export_order(due_within_days))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.get("/export")
def export_bianzhi_jobs(
    keyword: Optional[str] = None,
    category: Optional[List[str]] = Query(None),
    province: Optional[List[str]] = Query(None),
    job_type: Optional[str] = None,
    edu: Optional[str] = None,
    updated_after: Optional[str] = None,
    due_within_days: Optional[int] = Query(None, ge=0, le=365),
    hide_expired: bool = False,
    fname: Optional[str] = None,
    max_rows: int = Query(2000, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """同步导出当前筛选结果 CSV（≤2000 行；更大请走 POST /api/export 异步任务）。"""
    q = apply_bianzhi_filters(db.query(BianzhiJob), {
        "keyword": keyword,
        "category": category,
        "province": province,
        "job_type": job_type,
        "edu": edu,
        "updated_after": updated_after,
        "due_within_days": due_within_days,
        "hide_expired": hide_expired,
    })
    rows = q.order_by(*bianzhi_export_order(due_within_days)).limit(max_rows).all()
    default = f"编制-{datetime.now().strftime('%Y%m%d')}"
    return csv_export.stream_csv(rows, BIANZHI_EXPORT_COLUMNS, csv_export.safe_fname(fname, default))


@router.get("/counts")
@cache.cached("bianzhi_counts", ttl=3600, stale=True)
def bianzhi_counts(db: Session = Depends(get_db)):
    """分类/省份计数（前端 chips 显示，1 小时缓存，失败回退旧缓存）。"""
    cats = (
        db.query(BianzhiJob.category, func.count())
        .filter(BianzhiJob.category != None, BianzhiJob.category != "")  # noqa: E711
        .group_by(BianzhiJob.category)
        .all()
    )
    provs = (
        db.query(BianzhiJob.province, func.count())
        .filter(BianzhiJob.province != None, BianzhiJob.province != "")  # noqa: E711
        .group_by(BianzhiJob.province)
        .all()
    )
    return {
        "categories": {c: n for c, n in cats},
        "provinces": {p: n for p, n in provs},
    }


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


@router.get("/{job_id}", response_model=BianzhiJobOut)
def get_bianzhi_job(job_id: int, db: Session = Depends(get_db)):
    """按 id 取单条（深链直开详情兑底）。"""
    job = db.query(BianzhiJob).filter(BianzhiJob.id == job_id).first()
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job
