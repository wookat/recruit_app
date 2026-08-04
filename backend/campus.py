"""校招/社招信息 API：/api/campus 列表与筛选项。"""
import re
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, case, or_, func
from sqlalchemy.orm import Session

import cache
import csv_export
from crud import edu_eligible_clause, multi_col_hit_clause, title_hit_rank
from database import get_db
from models import CampusJob, LinkCheck
from normalizer import CITY_TO_PROVINCE

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
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class CampusList(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[CampusJobOut]


#: 列表导出列（attr, 中文列名）
CAMPUS_EXPORT_COLUMNS = [
    ("company", "公司"),
    ("positions", "招聘岗位"),
    ("company_type", "企业类型"),
    ("industry", "行业"),
    ("batch", "批次"),
    ("grad_years", "届别"),
    ("no_exam", "笔试要求"),
    ("edu_requirement", "学历要求"),
    ("major_requirement", "专业要求"),
    ("locations", "工作地点"),
    ("start_date", "开始时间"),
    ("deadline_text", "截止时间"),
    ("referral_code", "内推码"),
    ("announce_url", "公告链接"),
    ("apply_url", "投递链接"),
    ("updated_at_src", "更新时间"),
]


def apply_campus_filters(q, f: dict):
    """列表/导出共用的筛选链；f 为列表接口同名参数的 dict。"""
    if f.get("hide_expired"):
        q = q.filter(or_(CampusJob.deadline_date == None,  # noqa: E711
                         CampusJob.deadline_date >= date.today()))
    if f.get("source_table"):
        q = q.filter(CampusJob.source_table.in_(f["source_table"]))
    if f.get("company_type"):
        q = q.filter(CampusJob.company_type.in_(f["company_type"]))
    if f.get("industry"):
        q = q.filter(or_(*(CampusJob.industry.ilike(f"%{i}%") for i in f["industry"])))
    if f.get("batch"):
        q = q.filter(CampusJob.batch.ilike(f"%{f['batch']}%"))
    if f.get("grad_year"):
        q = q.filter(CampusJob.grad_years.ilike(f"%{f['grad_year']}%"))
    if f.get("no_exam_only"):
        q = q.filter(or_(CampusJob.no_exam.ilike("%免笔试%"), CampusJob.no_exam == "/"))
    if f.get("referral_only"):
        q = q.filter(CampusJob.referral_code != None, CampusJob.referral_code != "")  # noqa: E711
    if f.get("edu"):
        q = q.filter(edu_eligible_clause(CampusJob.edu_requirement, f["edu"]))
    if f.get("location"):
        terms = [t.strip() for t in f["location"].split(",") if t.strip()]
        if terms:
            q = q.filter(or_(*(CampusJob.locations.ilike(f"%{t}%") for t in terms)))
    if f.get("updated_after"):
        q = q.filter(CampusJob.updated_at_src >= f["updated_after"])
    if f.get("updated_before"):
        q = q.filter(CampusJob.updated_at_src <= f["updated_before"])
    if f.get("keyword"):
        q = q.filter(multi_col_hit_clause(
            [
                CampusJob.company,
                CampusJob.positions,
                CampusJob.industry,
                CampusJob.major_requirement,
            ],
            f["keyword"],
        ))
    if f.get("due_within_days") is not None:
        today = date.today()
        q = q.filter(CampusJob.deadline_date >= today,
                     CampusJob.deadline_date <= today + timedelta(days=f["due_within_days"]))
    return q


def campus_export_order(due_within_days, keyword=None):
    if due_within_days is not None:
        base = (CampusJob.deadline_date.asc(), CampusJob.id.desc())
    else:
        # 默认视图：已截止（deadline_date 早于今天）沉底，无日期视为未截止
        expired_rank = case(
            (and_(CampusJob.deadline_date != None, CampusJob.deadline_date < date.today()), 1),  # noqa: E711
            else_=0,
        )
        base = (expired_rank.asc(), CampusJob.updated_at_src.desc().nullslast(), CampusJob.id.desc())
    if keyword:
        # 关键词搜索时标题（公司名）命中优先，其次岗位命中
        return (
            title_hit_rank(CampusJob.company, keyword),
            title_hit_rank(CampusJob.positions, keyword),
            *base,
        )
    return base


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
    edu: Optional[str] = None,
    location: Optional[str] = None,
    updated_after: Optional[str] = None,
    updated_before: Optional[str] = None,
    due_within_days: Optional[int] = Query(None, ge=0, le=365),
    hide_expired: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    q = apply_campus_filters(db.query(CampusJob), {
        "keyword": keyword,
        "source_table": source_table,
        "company_type": company_type,
        "industry": industry,
        "batch": batch,
        "grad_year": grad_year,
        "no_exam_only": no_exam_only,
        "referral_only": referral_only,
        "edu": edu,
        "location": location,
        "updated_after": updated_after,
        "updated_before": updated_before,
        "due_within_days": due_within_days,
        "hide_expired": hide_expired,
    })
    total = q.count()
    items = (
        q.order_by(*campus_export_order(due_within_days, keyword))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.get("/export")
def export_campus_jobs(
    keyword: Optional[str] = None,
    source_table: Optional[List[str]] = Query(None),
    company_type: Optional[List[str]] = Query(None),
    industry: Optional[List[str]] = Query(None),
    batch: Optional[str] = None,
    grad_year: Optional[str] = None,
    no_exam_only: bool = False,
    referral_only: bool = False,
    edu: Optional[str] = None,
    location: Optional[str] = None,
    updated_after: Optional[str] = None,
    updated_before: Optional[str] = None,
    due_within_days: Optional[int] = Query(None, ge=0, le=365),
    hide_expired: bool = False,
    fname: Optional[str] = None,
    max_rows: int = Query(2000, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """同步导出当前筛选结果 CSV（≤2000 行；更大请走 POST /api/export 异步任务）。"""
    q = apply_campus_filters(db.query(CampusJob), {
        "keyword": keyword,
        "source_table": source_table,
        "company_type": company_type,
        "industry": industry,
        "batch": batch,
        "grad_year": grad_year,
        "no_exam_only": no_exam_only,
        "referral_only": referral_only,
        "edu": edu,
        "location": location,
        "updated_after": updated_after,
        "updated_before": updated_before,
        "due_within_days": due_within_days,
        "hide_expired": hide_expired,
    })
    rows = q.order_by(*campus_export_order(due_within_days)).limit(max_rows).all()
    default = f"校招-{datetime.now().strftime('%Y%m%d')}"
    return csv_export.stream_csv(rows, CAMPUS_EXPORT_COLUMNS, csv_export.safe_fname(fname, default))


@router.get("/timeline")
@cache.cached("campus_timeline", ttl=3600, stale=True)
def campus_timeline(db: Session = Depends(get_db)):
    """按更新日期（updated_at_src）聚合的每日岗位数（时间线视图，1 小时缓存）。"""
    day = func.substr(func.replace(CampusJob.updated_at_src, "/", "-"), 1, 10)
    rows = (
        db.query(day, func.count())
        .filter(day.op("~")(r"^\d{4}-\d{2}-\d{2}$"))
        .group_by(day)
        .order_by(day)
        .all()
    )
    return {"days": {d: n for d, n in rows}}


@router.get("/counts")
@cache.cached("campus_counts", ttl=3600, stale=True)
def campus_counts(db: Session = Depends(get_db)):
    """企业类型/批次计数（前端 chips 显示，1 小时缓存，失败回退旧缓存）。"""
    ctypes = (
        db.query(CampusJob.company_type, func.count())
        .filter(CampusJob.company_type != None, CampusJob.company_type != "")  # noqa: E711
        .group_by(CampusJob.company_type)
        .all()
    )
    batches = (
        db.query(CampusJob.batch, func.count())
        .filter(CampusJob.batch != None, CampusJob.batch != "")  # noqa: E711
        .group_by(CampusJob.batch)
        .all()
    )
    locs = (
        db.query(CampusJob.locations, func.count())
        .filter(CampusJob.locations != None, CampusJob.locations != "")  # noqa: E711
        .group_by(CampusJob.locations)
        .all()
    )
    _NON_CITY = {
        "全国", "全国多地", "全国各地", "多地", "其他", "海外", "待定", "不限",
        "广东", "浙江", "江苏", "山东", "河北", "河南", "湖南", "湖北", "四川",
        "福建", "安徽", "江西", "山西", "陕西", "云南", "贵州", "广西", "辽宁",
        "黑龙江", "甘肃", "青海", "海南", "内蒙古", "新疆", "西藏", "宁夏",
    }
    city_counts: dict = {}
    for loc, n in locs:
        for t in re.split(r"[|、,，/;；\s]+", loc):
            t = t.strip()
            if len(t) > 2 and t.endswith("市"):
                t = t[:-1]
            if not t or len(t) > 6 or t in _NON_CITY or t.endswith(("省", "自治州")):
                continue
            city_counts[t] = city_counts.get(t, 0) + n
    cities = dict(sorted(city_counts.items(), key=lambda x: -x[1])[:80])
    _municipalities = {"北京", "天津", "上海", "重庆"}
    city_provinces = {
        c: (c if c in _municipalities else CITY_TO_PROVINCE[c])
        for c in cities
        if c in _municipalities or c in CITY_TO_PROVINCE
    }
    return {
        "company_types": {t: n for t, n in ctypes},
        "batches": {b: n for b, n in batches},
        "cities": cities,
        "city_provinces": city_provinces,
    }


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


@router.get("/link-status")
def link_status(url: str, db: Session = Depends(get_db)):
    """查询死链扫描结果（link_checks，每周更新；未扫描过返回 checked=False）。"""
    row = db.query(LinkCheck).filter(LinkCheck.url == url).first()
    if row is None:
        return {"checked": False}
    return {
        "checked": True,
        "ok": bool(row.ok),
        "status_code": row.status_code,
        "checked_at": row.checked_at,
    }


@router.get("/{job_id}", response_model=CampusJobOut)
def get_campus_job(job_id: int, db: Session = Depends(get_db)):
    """按 id 取单条（深链直开详情兑底）。"""
    job = db.query(CampusJob).filter(CampusJob.id == job_id).first()
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job
