"""编制类招聘公告 API：/api/bianzhi 列表与筛选项。"""
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
    created_at: Optional[datetime] = None

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
    if f.get("city"):
        terms = [t.strip() for t in f["city"].split(",") if t.strip()]
        if terms:
            q = q.filter(or_(*(BianzhiJob.work_location.ilike(f"%{t}%") for t in terms)))
    if f.get("job_type"):
        q = q.filter(BianzhiJob.job_type.ilike(f"%{f['job_type']}%"))
    if f.get("edu"):
        q = q.filter(edu_eligible_clause(BianzhiJob.edu_requirement, f["edu"]))
    if f.get("updated_after"):
        q = q.filter(func.substr(func.replace(BianzhiJob.updated_at_src, "/", "-"), 1, 10) >= f["updated_after"])
    if f.get("updated_before"):
        q = q.filter(func.substr(func.replace(BianzhiJob.updated_at_src, "/", "-"), 1, 10) <= f["updated_before"])
    if f.get("keyword"):
        q = q.filter(multi_col_hit_clause(
            [
                BianzhiJob.employer,
                BianzhiJob.work_location,
                BianzhiJob.major_requirement,
            ],
            f["keyword"],
        ))
    if f.get("due_within_days") is not None:
        today = date.today()
        q = q.filter(BianzhiJob.deadline_date >= today,
                     BianzhiJob.deadline_date <= today + timedelta(days=f["due_within_days"]))
    return q


def bianzhi_export_order(due_within_days, keyword=None):
    if due_within_days is not None:
        base = (BianzhiJob.deadline_date.asc(), BianzhiJob.id.desc())
    else:
        # 默认视图：已截止（deadline_date 早于今天）沉底，无日期视为未截止
        expired_rank = case(
            (and_(BianzhiJob.deadline_date != None, BianzhiJob.deadline_date < date.today()), 1),  # noqa: E711
            else_=0,
        )
        base = (expired_rank.asc(), BianzhiJob.updated_at_src.desc().nullslast(), BianzhiJob.id.desc())
    if keyword:
        # 关键词搜索时标题（单位名）命中优先
        return (title_hit_rank(BianzhiJob.employer, keyword), *base)
    return base


@router.get("", response_model=BianzhiList)
def list_bianzhi_jobs(
    keyword: Optional[str] = None,
    category: Optional[List[str]] = Query(None),
    province: Optional[List[str]] = Query(None),
    city: Optional[str] = None,
    job_type: Optional[str] = None,
    edu: Optional[str] = None,
    updated_after: Optional[str] = None,
    updated_before: Optional[str] = None,
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
        "city": city,
        "job_type": job_type,
        "edu": edu,
        "updated_after": updated_after,
        "updated_before": updated_before,
        "due_within_days": due_within_days,
        "hide_expired": hide_expired,
    })
    total = q.count()
    items = (
        q.order_by(*bianzhi_export_order(due_within_days, keyword))
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
    city: Optional[str] = None,
    job_type: Optional[str] = None,
    edu: Optional[str] = None,
    updated_after: Optional[str] = None,
    updated_before: Optional[str] = None,
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
        "city": city,
        "job_type": job_type,
        "edu": edu,
        "updated_after": updated_after,
        "updated_before": updated_before,
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
    locs = (
        db.query(BianzhiJob.province, BianzhiJob.work_location, func.count())
        .filter(BianzhiJob.work_location != None, BianzhiJob.work_location != "")  # noqa: E711
        .group_by(BianzhiJob.province, BianzhiJob.work_location)
        .all()
    )
    _NON_CITY = {"全国", "全国多地", "全国各地", "多地", "其他", "海外", "待定", "不限",
                 "亚洲", "欧洲", "非洲", "美洲", "大洋洲", "国内", "国外", "境外", "各地", "异地", "远程"}
    city_counts: dict = {}
    city_prov_counts: dict = {}
    for prov, loc, n in locs:
        for t in re.split(r"[|、,，/;；\s]+", loc):
            t = t.strip()
            if len(t) > 2 and t.endswith("市"):
                t = t[:-1]
            if not t or len(t) > 8 or t in _NON_CITY or t.endswith("省"):
                continue
            city_counts[t] = city_counts.get(t, 0) + n
            if prov and not re.search(r"[|、,，/;；\s]", prov):
                key = (t, prov)
                city_prov_counts[key] = city_prov_counts.get(key, 0) + n
    cities = dict(sorted(city_counts.items(), key=lambda x: -x[1])[:200])
    city_provinces: dict = {}
    for (t, prov), n in city_prov_counts.items():
        if t not in cities:
            continue
        best = city_provinces.get(t)
        if best is None or n > city_prov_counts[(t, best)]:
            city_provinces[t] = prov
    return {
        "categories": {c: n for c, n in cats},
        "provinces": {p: n for p, n in provs},
        "cities": cities,
        "city_provinces": city_provinces,
    }


@router.get("/timeline")
@cache.cached("bianzhi_timeline", ttl=3600, stale=True)
def bianzhi_timeline(db: Session = Depends(get_db)):
    """按更新日期（updated_at_src）聚合的每日岗位数（时间线视图，1 小时缓存）。"""
    day = func.substr(func.replace(BianzhiJob.updated_at_src, "/", "-"), 1, 10)
    rows = (
        db.query(day, func.count())
        .filter(day.op("~")(r"^\d{4}-\d{2}-\d{2}$"))
        .group_by(day)
        .order_by(day)
        .all()
    )
    return {"days": {d: n for d, n in rows}}


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
