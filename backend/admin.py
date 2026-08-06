"""管理后台 API：数据概况、采集来源管理、公告审核。

鉴权：请求头 X-Admin-Token 必须等于环境变量 ADMIN_TOKEN。
"""
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from cache import get_or_set, get_redis
from database import get_db
from models import Feedback, Position, WatchSource, Announcement, CrawlRun
from celery_app import celery_app
from tasks import DQ_REPORT_KEY, data_quality_audit, refresh_feishu_data
import collector
import precompute
import quality

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


@router.get("/quality-issues", dependencies=[Depends(require_admin)])
def quality_issues(db: Session = Depends(get_db)):
    """三表常见脏数据扫描：各类计数 + 样例 20 条（只读，1h 缓存）。"""
    return get_or_set(
        quality.QUALITY_ISSUES_KEY, quality.QUALITY_ISSUES_TTL,
        lambda: quality.compute_quality_issues(db),
    )


@router.get("/feedback", dependencies=[Depends(require_admin)])
def list_feedback(db: Session = Depends(get_db)):
    """用户「举报数据有误」反馈：最近 50 条 + 待处理数。"""
    rows = db.query(Feedback).order_by(Feedback.created_at.desc()).limit(50).all()
    pending = db.query(func.count(Feedback.id)).filter(Feedback.handled == 0).scalar() or 0
    return {
        "pending": int(pending),
        "items": [
            {
                "id": f.id,
                "board": f.board,
                "item_id": f.item_id,
                "issue_type": f.issue_type,
                "note": f.note,
                "handled": bool(f.handled),
                "created_at": f.created_at.isoformat() if f.created_at else None,
            }
            for f in rows
        ],
    }


@router.post("/feedback/{fid}/handled", dependencies=[Depends(require_admin)])
def set_feedback_handled(fid: int, handled: bool = Query(True), db: Session = Depends(get_db)):
    """标记反馈已处理/待处理。"""
    fb = db.query(Feedback).filter(Feedback.id == fid).first()
    if not fb:
        raise HTTPException(status_code=404, detail="反馈不存在")
    fb.handled = 1 if handled else 0
    db.commit()
    return {"ok": True, "id": fid, "handled": bool(fb.handled)}


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


@router.get("/health-summary", dependencies=[Depends(require_admin)])
def health_summary(db: Session = Depends(get_db)):
    """系统健康概览：24h 采集统计、热缓存 TTL、表行数估算、质量审计摘要（均为轻量查询）。"""
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    runs = (
        db.query(CrawlRun)
        .filter(CrawlRun.started_at >= since, CrawlRun.source_id.isnot(None))
        .order_by(CrawlRun.id.desc())
        .limit(500)
        .all()
    )
    success = sum(1 for r in runs if r.status == "success")
    failed = sum(1 for r in runs if r.status in ("error", "partial"))
    latest_by_source: dict = {}
    for r in runs:
        if r.source_id not in latest_by_source:
            duration = None
            if r.started_at and r.finished_at:
                duration = round((r.finished_at - r.started_at).total_seconds(), 1)
            latest_by_source[r.source_id] = {
                "source_id": r.source_id,
                "status": r.status,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "duration_seconds": duration,
                "rows_ingested": r.rows_ingested,
            }
    if latest_by_source:
        names = dict(
            db.query(WatchSource.id, WatchSource.name)
            .filter(WatchSource.id.in_(latest_by_source.keys()))
            .all()
        )
        for sid, item in latest_by_source.items():
            item["source_name"] = names.get(sid) or f"#{sid}"

    alert = (
        db.query(CrawlRun)
        .filter(CrawlRun.source_id.is_(None), CrawlRun.status == "alert")
        .order_by(CrawlRun.id.desc())
        .first()
    )
    failed_sources = []
    if alert and alert.error:
        try:
            failed_sources = json.loads(alert.error)
        except ValueError:
            failed_sources = [alert.error]

    r = get_redis()
    cache_keys = {
        "stats": precompute.STATS_KEY,
        "filters": precompute.FILTERS_KEY,
        "dq_report": DQ_REPORT_KEY,
    }
    caches = {name: max(r.ttl(key), 0) for name, key in cache_keys.items()}

    table_counts = {
        rel: int(tup)
        for rel, tup in db.execute(text(
            "SELECT relname, greatest(reltuples, 0)::bigint FROM pg_class "
            "WHERE relname IN ('positions', 'campus_jobs', 'bianzhi_jobs') AND relkind = 'r'"
        )).all()
    }

    dq_summary = None
    raw = r.get(DQ_REPORT_KEY)
    if raw:
        report = json.loads(raw)
        dq_summary = {
            "generated_at": report.get("generated_at"),
            "rows": report.get("rows"),
            "deadline_parse_rate": (report.get("signup_deadline") or {}).get("parse_rate"),
        }

    # 最近 14 天趋势：每日成功/失败次数与飞书两源新增条数（started_at 索引范围扫描）
    trend = [
        {
            "date": str(row.d),
            "crawl_success": row.crawl_success,
            "crawl_fail": row.crawl_fail,
            "campus_added": int(row.campus_added),
            "bianzhi_added": int(row.bianzhi_added),
        }
        for row in db.execute(text("""
            SELECT date(cr.started_at) AS d,
                   count(*) FILTER (WHERE cr.status = 'success') AS crawl_success,
                   count(*) FILTER (WHERE cr.status IN ('error', 'partial')) AS crawl_fail,
                   coalesce(sum(cr.rows_ingested) FILTER (WHERE ws.name = 'feishu_campus'), 0) AS campus_added,
                   coalesce(sum(cr.rows_ingested) FILTER (WHERE ws.name = 'feishu_bianzhi'), 0) AS bianzhi_added
            FROM crawl_runs cr
            LEFT JOIN watch_sources ws ON ws.id = cr.source_id
            WHERE cr.started_at >= now() - interval '14 days'
              AND cr.source_id IS NOT NULL
            GROUP BY 1 ORDER BY 1
        """)).all()
    ]

    # 近 14 天访问趋势（自建 PV 统计，表可能尚未建，出错忽略）
    visits = []
    try:
        visits = [
            {"date": str(row.d), "pv": int(row.pv), "sessions": int(row.sessions)}
            for row in db.execute(text("""
                SELECT p.day AS d, sum(p.pv) AS pv,
                       coalesce((SELECT count(*) FROM metrics_sessions_daily s WHERE s.day = p.day), 0) AS sessions
                FROM metrics_pv_daily p
                WHERE p.day >= CURRENT_DATE - interval '13 days'
                  AND p.board <> 'event'
                GROUP BY 1 ORDER BY 1
            """)).all()
        ]
    except Exception:  # noqa: BLE001
        db.rollback()

    # 留存埋点事件计数（近 14 天，board='event' 行）
    events = {}
    try:
        events = {
            row.page: int(row.n)
            for row in db.execute(text("""
                SELECT page, sum(pv) AS n FROM metrics_pv_daily
                WHERE board = 'event' AND day >= CURRENT_DATE - interval '13 days'
                GROUP BY page
            """)).all()
        }
    except Exception:  # noqa: BLE001
        db.rollback()

    # 飞书源失效嫌疑：连续 2 天同步 0 新增且历史平均 >0
    stale_sources = []
    try:
        for row in db.execute(text("""
            SELECT ws.name,
                   count(*) FILTER (WHERE cr.started_at >= CURRENT_DATE - 1) AS recent_runs,
                   coalesce(sum(cr.rows_ingested) FILTER (WHERE cr.started_at >= CURRENT_DATE - 1), 0) AS recent_added,
                   avg(cr.rows_ingested) FILTER (WHERE cr.started_at < CURRENT_DATE - 1) AS hist_avg,
                   max(cr.finished_at) FILTER (WHERE cr.rows_ingested > 0) AS last_ingest_at,
                   max(cr.finished_at) FILTER (WHERE cr.status = 'success') AS last_success_at
            FROM crawl_runs cr
            JOIN watch_sources ws ON ws.id = cr.source_id
            WHERE ws.category = '飞书表格'
            GROUP BY ws.name
        """)).all():
            if row.recent_runs >= 2 and row.recent_added == 0 and (row.hist_avg or 0) > 0:
                stale_sources.append({
                    "name": row.name,
                    "last_success_at": row.last_success_at.isoformat() if row.last_success_at else None,
                    "last_ingest_at": row.last_ingest_at.isoformat() if row.last_ingest_at else None,
                    "hist_avg_added": round(float(row.hist_avg), 1),
                })
    except Exception:  # noqa: BLE001
        db.rollback()

    return {
        "trend": trend,
        "visits": visits,
        "events": events,
        "stale_sources": stale_sources,
        "crawl_24h": {
            "success": success,
            "failed": failed,
            "total": len(runs),
            "latest_by_source": list(latest_by_source.values()),
        },
        "failed_sources_yesterday": {
            "at": alert.finished_at.isoformat() if alert and alert.finished_at else None,
            "sources": failed_sources,
        },
        "cache_ttl_seconds": caches,
        "table_estimates": table_counts,
        "data_quality": dq_summary,
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


@router.get("/sync-today", dependencies=[Depends(require_admin)])
def sync_today(db: Session = Depends(get_db)):
    """今日各源同步结果明细：每源最近一次运行的新增行数与失败原因。"""
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    runs = (
        db.query(CrawlRun)
        .filter(CrawlRun.started_at >= start, CrawlRun.source_id.isnot(None))
        .order_by(CrawlRun.id.desc())
        .limit(300)
        .all()
    )
    latest: dict = {}
    for r in runs:
        latest.setdefault(r.source_id, r)
    names = {}
    if latest:
        names = dict(
            db.query(WatchSource.id, WatchSource.name)
            .filter(WatchSource.id.in_(latest.keys()))
            .all()
        )
    items = [
        {
            "source_id": sid,
            "source_name": names.get(sid) or f"#{sid}",
            "status": r.status,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            "rows_ingested": r.rows_ingested,
            "error": r.error,
        }
        for sid, r in latest.items()
    ]
    items.sort(key=lambda it: it["started_at"] or "", reverse=True)
    return {"date": start.date().isoformat(), "items": items}


@router.post("/sync-now", dependencies=[Depends(require_admin)])
def sync_now():
    """立即触发飞书数据同步（复用每日 refresh_feishu_data Celery 任务），返回 task_id 供轮询。"""
    task = refresh_feishu_data.delay()
    return {"task_id": task.id}


@router.get("/sync-status/{task_id}", dependencies=[Depends(require_admin)])
def sync_status(task_id: str):
    """查询触发的同步任务状态：PENDING/STARTED/SUCCESS/FAILURE。"""
    res = celery_app.AsyncResult(task_id)
    out: dict = {"state": res.state}
    if res.state == "SUCCESS":
        out["result"] = res.result
    elif res.state == "FAILURE":
        out["error"] = str(res.result)
    return out
