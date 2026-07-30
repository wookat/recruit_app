"""管理后台 API：数据概况、采集来源管理、公告审核。

鉴权：请求头 X-Admin-Token 必须等于环境变量 ADMIN_TOKEN。
"""
import json
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from cache import get_redis
from database import get_db
from models import Position, WatchSource, Announcement, CrawlRun
from tasks import DQ_REPORT_KEY, data_quality_audit
import collector

router = APIRouter(prefix="/api/admin", tags=["admin"])


def require_admin(x_admin_token: Optional[str] = Header(None)):
    token = os.getenv("ADMIN_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="管理后台未配置（缺少 ADMIN_TOKEN）")
    if x_admin_token != token:
        raise HTTPException(status_code=401, detail="无效的管理令牌")


class WatchSourceIn(BaseModel):
    name: str
    index_url: str
    keywords: Optional[str] = None
    category: Optional[str] = None
    year: Optional[int] = None
    enabled: int = 1
    interval_minutes: int = 60


def _src_out(s: WatchSource) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "index_url": s.index_url,
        "keywords": s.keywords,
        "category": s.category,
        "year": s.year,
        "enabled": s.enabled,
        "interval_minutes": s.interval_minutes,
        "last_checked_at": s.last_checked_at.isoformat() if s.last_checked_at else None,
        "last_status": s.last_status,
        "last_message": s.last_message,
    }


def _ann_out(a: Announcement) -> dict:
    return {
        "id": a.id,
        "source_id": a.source_id,
        "title": a.title,
        "url": a.url,
        "status": a.status,
        "detected_at": a.detected_at.isoformat() if a.detected_at else None,
    }


@router.get("/overview", dependencies=[Depends(require_admin)])
def overview(db: Session = Depends(get_db)):
    total = db.query(func.count(Position.id)).scalar()
    clean = (
        db.query(func.count(Position.id))
        .filter(Position.dup_of_id.is_(None), Position.invalid_reason.is_(None))
        .scalar()
    )
    dup = db.query(func.count(Position.id)).filter(Position.dup_of_id.isnot(None)).scalar()
    invalid = db.query(func.count(Position.id)).filter(Position.invalid_reason.isnot(None)).scalar()
    by_year = (
        db.query(Position.year, func.count(Position.id))
        .filter(Position.dup_of_id.is_(None), Position.invalid_reason.is_(None))
        .group_by(Position.year)
        .order_by(Position.year.desc())
        .all()
    )
    src_total = db.query(func.count(WatchSource.id)).scalar()
    src_enabled = db.query(func.count(WatchSource.id)).filter(WatchSource.enabled == 1).scalar()
    src_error = db.query(func.count(WatchSource.id)).filter(WatchSource.last_status == "error").scalar()
    ann_new = db.query(func.count(Announcement.id)).filter(Announcement.status == "new").scalar()
    ann_total = db.query(func.count(Announcement.id)).scalar()
    return {
        "positions": {"total": total, "clean": clean, "dup": dup, "invalid": invalid},
        "by_year": [{"year": y, "count": c} for y, c in by_year],
        "watch_sources": {"total": src_total, "enabled": src_enabled, "error": src_error},
        "announcements": {"new": ann_new, "total": ann_total},
    }


@router.get("/watch-sources", dependencies=[Depends(require_admin)])
def list_watch_sources(db: Session = Depends(get_db)):
    return [_src_out(s) for s in db.query(WatchSource).order_by(WatchSource.id).all()]


@router.post("/watch-sources", dependencies=[Depends(require_admin)])
def create_watch_source(body: WatchSourceIn, db: Session = Depends(get_db)):
    if db.query(WatchSource.id).filter(WatchSource.name == body.name).first():
        raise HTTPException(status_code=409, detail="同名来源已存在")
    src = WatchSource(**body.model_dump())
    db.add(src)
    db.commit()
    db.refresh(src)
    return _src_out(src)


@router.patch("/watch-sources/{source_id}", dependencies=[Depends(require_admin)])
def update_watch_source(source_id: int, body: WatchSourceIn, db: Session = Depends(get_db)):
    src = db.get(WatchSource, source_id)
    if not src:
        raise HTTPException(status_code=404, detail="来源不存在")
    for k, v in body.model_dump().items():
        setattr(src, k, v)
    db.commit()
    return _src_out(src)


@router.delete("/watch-sources/{source_id}", dependencies=[Depends(require_admin)])
def delete_watch_source(source_id: int, db: Session = Depends(get_db)):
    src = db.get(WatchSource, source_id)
    if not src:
        raise HTTPException(status_code=404, detail="来源不存在")
    db.delete(src)
    db.commit()
    return {"ok": True}


@router.post("/watch-sources/{source_id}/check", dependencies=[Depends(require_admin)])
def check_watch_source(source_id: int, db: Session = Depends(get_db)):
    src = db.get(WatchSource, source_id)
    if not src:
        raise HTTPException(status_code=404, detail="来源不存在")
    return collector.check_source(db, src)


@router.post("/watch-sources/seed", dependencies=[Depends(require_admin)])
def seed_watch_sources(db: Session = Depends(get_db)):
    """导入 watch_2027_announcements.py 中的默认监控配置。"""
    from watch_2027_announcements import WATCHES

    added = 0
    for w in WATCHES:
        if db.query(WatchSource.id).filter(WatchSource.name == w["name"]).first():
            continue
        db.add(
            WatchSource(
                name=w["name"],
                index_url=w["index_urls"][0],
                keywords=",".join(w.get("keywords", [])),
                category=w.get("job_type"),
                year=w.get("year"),
                enabled=1,
                interval_minutes=w.get("interval_minutes", 60),
            )
        )
        added += 1
    db.commit()
    return {"added": added}


@router.get("/data-quality", dependencies=[Depends(require_admin)])
def get_data_quality():
    """返回最近一次数据质量审计报告（tasks.data_quality_audit 写入 Redis dq:report）。"""
    raw = get_redis().get(DQ_REPORT_KEY)
    if not raw:
        raise HTTPException(status_code=404, detail="报告未生成，可先 POST /api/admin/data-quality/refresh")
    return json.loads(raw)


@router.post("/data-quality/refresh", dependencies=[Depends(require_admin)])
def refresh_data_quality():
    """异步触发一次数据质量审计。"""
    task = data_quality_audit.delay()
    return {"task_id": task.id, "status": "started"}


@router.get("/announcements", dependencies=[Depends(require_admin)])
def list_announcements(
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(Announcement)
    if status:
        q = q.filter(Announcement.status == status)
    rows = q.order_by(Announcement.detected_at.desc()).limit(limit).all()
    return [_ann_out(a) for a in rows]


class AnnouncementPatch(BaseModel):
    status: str


@router.patch("/announcements/{ann_id}", dependencies=[Depends(require_admin)])
def update_announcement(ann_id: int, body: AnnouncementPatch, db: Session = Depends(get_db)):
    ann = db.get(Announcement, ann_id)
    if not ann:
        raise HTTPException(status_code=404, detail="公告不存在")
    if body.status not in ("new", "processed", "ignored", "error"):
        raise HTTPException(status_code=422, detail="非法状态")
    ann.status = body.status
    db.commit()
    return _ann_out(ann)


@router.post("/check-all", dependencies=[Depends(require_admin)])
def check_all(db: Session = Depends(get_db)):
    """立即检查所有到期启用的来源。"""
    return {"results": collector.check_due_sources(db)}


def _run_out(r: CrawlRun) -> dict:
    return {
        "id": r.id,
        "source_id": r.source_id,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        "status": r.status,
        "announcements_found": r.announcements_found,
        "attachments_downloaded": r.attachments_downloaded,
        "rows_parsed": r.rows_parsed,
        "rows_ingested": r.rows_ingested,
        "error": r.error,
    }


@router.get("/crawl-runs", dependencies=[Depends(require_admin)])
def list_crawl_runs(
    source_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """分页列出采集运行历史。"""
    q = db.query(CrawlRun)
    if source_id is not None:
        q = q.filter(CrawlRun.source_id == source_id)
    if status:
        q = q.filter(CrawlRun.status == status)
    total = q.count()
    rows = (
        q.order_by(CrawlRun.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"total": total, "page": page, "page_size": page_size, "items": [_run_out(r) for r in rows]}
