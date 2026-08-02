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
from models import BianzhiJob, CampusJob, Position, WatchSource, Announcement, CrawlRun
from tasks import DQ_REPORT_KEY, data_quality_audit
import collector
import precompute

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


QUALITY_ISSUES_KEY = "admin:quality_issues"
QUALITY_ISSUES_TTL = 3600
URL_LITERALS = ("投递", "公告")
OLD_DEADLINE_CUTOFF = "2020-01-01"
SAMPLE_LIMIT = 20


def _blank(col):
    return (col.is_(None)) | (func.trim(col) == "")


def _issue(db: Session, board: str, key: str, label: str, model, cond, value_col) -> dict:
    count = db.query(func.count(model.id)).filter(cond).scalar() or 0
    samples = []
    if count:
        rows = (
            db.query(model.id, value_col)
            .filter(cond)
            .order_by(model.id)
            .limit(SAMPLE_LIMIT)
            .all()
        )
        samples = [{"id": r[0], "value": str(r[1]) if r[1] is not None else ""} for r in rows]
    return {"board": board, "key": key, "label": label, "count": count, "samples": samples}


def _compute_quality_issues(db: Session) -> dict:
    pos_valid = Position.dup_of_id.is_(None) & Position.invalid_reason.is_(None)
    issues = [
        _issue(
            db, "positions", "pos_empty_url", "体制内：来源链接为空",
            Position, pos_valid & _blank(Position.source_url), Position.employer,
        ),
        _issue(
            db, "positions", "pos_literal_url", "体制内：链接为「投递/公告」字面量",
            Position, pos_valid & func.trim(Position.source_url).in_(URL_LITERALS), Position.source_url,
        ),
        _issue(
            db, "positions", "pos_old_deadline", "体制内：报名截止早于 2020",
            Position, pos_valid & (Position.signup_deadline < OLD_DEADLINE_CUTOFF), Position.signup_deadline,
        ),
        _issue(
            db, "positions", "pos_empty_employer", "体制内：招考单位全空",
            Position, pos_valid & _blank(Position.employer), Position.position_example,
        ),
        _issue(
            db, "campus", "campus_empty_url", "校招：公告/投递链接均为空",
            CampusJob, _blank(CampusJob.announce_url) & _blank(CampusJob.apply_url), CampusJob.company,
        ),
        _issue(
            db, "campus", "campus_literal_url", "校招：链接为「投递/公告」字面量",
            CampusJob,
            func.trim(CampusJob.announce_url).in_(URL_LITERALS)
            | func.trim(CampusJob.apply_url).in_(URL_LITERALS),
            CampusJob.company,
        ),
        _issue(
            db, "campus", "campus_old_deadline", "校招：截止日期早于 2020",
            CampusJob, CampusJob.deadline_date < OLD_DEADLINE_CUTOFF, CampusJob.deadline_date,
        ),
        _issue(
            db, "campus", "campus_trailing_pipe", "校招：地点尾部多「|」",
            CampusJob, CampusJob.locations.like("%|"), CampusJob.locations,
        ),
        _issue(
            db, "campus", "campus_empty_company", "校招：公司名全空",
            CampusJob, _blank(CampusJob.company), CampusJob.positions,
        ),
        _issue(
            db, "bianzhi", "bz_empty_url", "编制：公告/投递链接均为空",
            BianzhiJob, _blank(BianzhiJob.announce_url) & _blank(BianzhiJob.apply_url), BianzhiJob.employer,
        ),
        _issue(
            db, "bianzhi", "bz_literal_url", "编制：链接为「投递/公告」字面量",
            BianzhiJob,
            func.trim(BianzhiJob.announce_url).in_(URL_LITERALS)
            | func.trim(BianzhiJob.apply_url).in_(URL_LITERALS),
            BianzhiJob.employer,
        ),
        _issue(
            db, "bianzhi", "bz_old_deadline", "编制：截止日期早于 2020",
            BianzhiJob, BianzhiJob.deadline_date < OLD_DEADLINE_CUTOFF, BianzhiJob.deadline_date,
        ),
        _issue(
            db, "bianzhi", "bz_empty_employer", "编制：招考单位全空",
            BianzhiJob, _blank(BianzhiJob.employer), BianzhiJob.job_type,
        ),
    ]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total": sum(i["count"] for i in issues),
        "issues": issues,
    }


@router.get("/quality-issues", dependencies=[Depends(require_admin)])
def quality_issues(db: Session = Depends(get_db)):
    """三表常见脏数据扫描：各类计数 + 样例 20 条（只读，1h 缓存）。"""
    return get_or_set(QUALITY_ISSUES_KEY, QUALITY_ISSUES_TTL, lambda: _compute_quality_issues(db))


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

    return {
        "trend": trend,
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
