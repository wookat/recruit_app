import io
import logging
import re
import os
import threading
import time
from urllib.parse import quote
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import pandas as pd
from fastapi import FastAPI, Depends, Query, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from database import engine, Base, get_db
from celery_app import celery_app
import crud
import models
import schemas
import cache
import csv_export
import share_meta
from admin import require_admin, router as admin_router
from campus import router as campus_router
from bianzhi import router as bianzhi_router
from jobs import router as jobs_router
from match import router as match_router
from push import router as push_router
import seo
from seo import router as seo_router
from tasks import EXPORTS_DIR, export_board_task, export_positions_task, scrape_year
import precompute

logger = logging.getLogger("uvicorn.error")


def _warm_hot_keywords_bg():
    try:
        result = precompute.warm_board_caches()
        logger.info("启动板块缓存预热完成: %s", result)
    except Exception as exc:  # noqa: BLE001
        logger.warning("启动板块缓存预热失败: %s: %s", type(exc).__name__, exc)
    try:
        result = precompute.warm_seo_pages(invalidate=False)  # 启动只补缺页，不失效已有热缓存
        logger.info("启动 SEO 页预热完成: %s", result)
    except Exception as exc:  # noqa: BLE001
        logger.warning("启动 SEO 页预热失败: %s: %s", type(exc).__name__, exc)
    try:
        result = precompute.warm_suggest_vocab()
        logger.info("启动联想词表预生成完成: %s", result)
    except Exception as exc:  # noqa: BLE001
        logger.warning("启动联想词表预生成失败: %s: %s", type(exc).__name__, exc)
    try:
        result = precompute.warm_hot_keywords()
        logger.info("启动热词预热完成: %s", result)
    except Exception as exc:  # noqa: BLE001  预热失败不影响启动
        logger.warning("启动热词预热失败: %s: %s", type(exc).__name__, exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
    threading.Thread(target=_warm_hot_keywords_bg, name="warm-hot-keywords", daemon=True).start()
    yield


app = FastAPI(title="体制内岗位检索系统", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://jobs.zalize.com",
        "http://localhost:5173",
        "http://localhost:8000",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
SLOW_REQUEST_SECONDS = 2.0


@app.middleware("http")
async def slow_request_log(request: Request, call_next):
    """慢请求观测：任何 API 请求超过阈值记录 method/path/耗时，便于定位线上偶发慢响应。"""
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = time.perf_counter() - start
    if elapsed > SLOW_REQUEST_SECONDS and request.url.path.startswith("/api/"):
        logger.warning("slow request: %s %s %.1fs status=%s",
                       request.method, request.url.path, elapsed, response.status_code)
    return response


# SSR SEO 页路径前缀：无效路径 404 时返回品牌化 HTML（含返回首页链接），不裸 JSON
SSR_404_PREFIXES = ("/zhaokao", "/daily", "/major", "/topic")


@app.exception_handler(StarletteHTTPException)
async def ssr_html_404_handler(request: Request, exc: StarletteHTTPException):
    path = request.url.path
    if (exc.status_code == 404
            and any(path == p or path.startswith(p + "/") for p in SSR_404_PREFIXES)):
        return HTMLResponse(seo.render_404(), status_code=404)
    return await http_exception_handler(request, exc)


app.include_router(admin_router)
app.include_router(campus_router)
app.include_router(bianzhi_router)
app.include_router(jobs_router)
app.include_router(match_router)
app.include_router(push_router)
app.include_router(seo_router)

SYNC_EXPORT_MAX_ROWS = 2000  # 同步导出快路径上限，更大请走 POST /api/export 异步任务


def _is_query_canceled(e: OperationalError) -> bool:
    """statement_timeout 取消（如冷缓存低选择性关键词全表扫）。"""
    return (
        "QueryCanceled" in type(getattr(e, "orig", None) or e).__name__
        or "canceling statement" in str(e)
    )


def _build_filter(
    year: Optional[List[int]] = None,
    job_type: Optional[List[str]] = None,
    exam_type: Optional[List[str]] = None,
    exam_type_norm: Optional[List[str]] = None,
    province: Optional[List[str]] = None,
    edu_requirement: Optional[List[str]] = None,
    work_location: Optional[List[str]] = None,
    keyword: Optional[str] = None,
    location: Optional[List[str]] = None,
    edu_level: Optional[List[str]] = None,
    major: Optional[str] = None,
    major_type: Optional[str] = "any",
    category: Optional[List[str]] = None,
    hide_expired: bool = False,
    created_after: Optional[datetime] = None,
) -> crud.PositionFilter:
    return crud.PositionFilter(
        year=year,
        job_type=job_type,
        exam_type=exam_type,
        exam_type_norm=exam_type_norm,
        province=province,
        edu_requirement=edu_requirement,
        work_location=work_location,
        keyword=keyword,
        location=location,
        edu_level=edu_level,
        major=major,
        major_type=major_type,
        category=category,
        hide_expired=hide_expired,
        created_after=created_after,
    )


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/freshness")
@cache.cached("freshness", ttl=900, stale=True)
def data_freshness(db: Session = Depends(get_db)):
    """各数据板块最近一次采集成功时间与总条数（crawl_runs 聚合，10 分钟缓存）。"""
    rows = db.execute(text("""
        SELECT CASE WHEN ws.name = 'feishu_campus' THEN 'campus'
                    WHEN ws.name = 'feishu_bianzhi' THEN 'bianzhi'
                    ELSE 'positions' END AS grp,
               max(cr.finished_at) AS last_success
        FROM crawl_runs cr
        LEFT JOIN watch_sources ws ON ws.id = cr.source_id
        WHERE cr.status = 'success' AND cr.finished_at IS NOT NULL
        GROUP BY 1
    """)).all()
    by_grp = {r.grp: r.last_success.isoformat() for r in rows}
    counts = {}
    for grp, sql in (
        ("positions", "SELECT count(*) FROM positions WHERE dup_of_id IS NULL AND invalid_reason IS NULL"),
        ("campus", "SELECT count(*) FROM campus_jobs"),
        ("bianzhi", "SELECT count(*) FROM bianzhi_jobs"),
    ):
        try:
            counts[grp] = db.execute(text(sql)).scalar()
        except Exception:  # noqa: BLE001  计数失败时前端显示「—」
            db.rollback()
            counts[grp] = None
    src_rows = db.execute(text("""
        SELECT ws.name, max(cr.finished_at) AS last_success
        FROM crawl_runs cr
        JOIN watch_sources ws ON ws.id = cr.source_id
        WHERE cr.status = 'success' AND cr.finished_at IS NOT NULL
        GROUP BY ws.name
    """)).all()
    out = {
        k: {"last_success": by_grp.get(k), "total": counts.get(k)}
        for k in ("positions", "campus", "bianzhi")
    }
    out["sources"] = {r.name: r.last_success.isoformat() for r in src_rows}
    return out


RECENT_BULK_THRESHOLD = 2000  # 单日入库超过该值视为全量同步导入，不逐条展示
RECENT_ITEM_MAX = 6


@app.get("/api/new-since")
def new_since(since: datetime = Query(...), db: Session = Depends(get_db)):
    """三板块自 since 之后新入库（created_at）岗位数，用于回访「新增 N 个岗位」提示条。"""
    if since.tzinfo is not None:
        since = since.astimezone(timezone.utc).replace(tzinfo=None)
    cutoff = datetime.now() - timedelta(days=30)
    if since < cutoff:
        since = cutoff
    counts = {}
    for grp, sql in (
        ("positions",
         "SELECT count(*) FROM positions WHERE dup_of_id IS NULL AND invalid_reason IS NULL AND created_at > :s"),
        ("campus", "SELECT count(*) FROM campus_jobs WHERE created_at > :s"),
        ("bianzhi", "SELECT count(*) FROM bianzhi_jobs WHERE created_at > :s"),
    ):
        try:
            counts[grp] = db.execute(text(sql), {"s": since}).scalar() or 0
        except Exception:  # noqa: BLE001
            db.rollback()
            counts[grp] = 0
    return counts


@app.get("/api/recent-updates")
@cache.cached("recent_updates", ttl=600)
def recent_updates(days: int = Query(7, ge=1, le=30), db: Session = Depends(get_db)):
    """近 N 天三板块新增岗位：按日分组的计数 + 每板块每日样例（入库时间 created_at）。"""
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    by_date: dict = {}

    def add(day: str, board: str, count: int):
        entry = {"count": count, "bulk": count > RECENT_BULK_THRESHOLD, "items": []}
        by_date.setdefault(day, {})[board] = entry
        return entry

    pos_days = db.execute(text("""
        SELECT created_at::date::text d, count(*) c FROM positions
        WHERE dup_of_id IS NULL AND invalid_reason IS NULL AND created_at >= :cutoff
        GROUP BY 1"""), {"cutoff": cutoff}).all()
    for d, c in pos_days:
        entry = add(d, "positions", c)
        if not entry["bulk"]:
            rows = db.execute(text("""
                SELECT id, coalesce(nullif(employer, ''), exam_type) AS title,
                       coalesce(position_example, '') AS sub, coalesce(province, '') AS extra
                FROM positions
                WHERE dup_of_id IS NULL AND invalid_reason IS NULL AND created_at::date = :d
                ORDER BY id DESC LIMIT :n"""), {"d": d, "n": RECENT_ITEM_MAX}).all()
            entry["items"] = [{"id": r.id, "title": r.title, "sub": r.sub, "extra": r.extra} for r in rows]

    campus_days = db.execute(text("""
        SELECT created_at::date::text d, count(*) c FROM campus_jobs
        WHERE created_at >= :cutoff GROUP BY 1"""), {"cutoff": cutoff}).all()
    for d, c in campus_days:
        entry = add(d, "campus", c)
        if not entry["bulk"]:
            rows = db.execute(text("""
                SELECT id, coalesce(company, '') AS title, coalesce(positions, '') AS sub, coalesce(batch, '') AS extra
                FROM campus_jobs WHERE created_at::date = :d
                ORDER BY id DESC LIMIT :n"""), {"d": d, "n": RECENT_ITEM_MAX}).all()
            entry["items"] = [{"id": r.id, "title": r.title, "sub": r.sub, "extra": r.extra} for r in rows]

    # 编制说明行（非岗位）排除：单位名含引导提示词（同 refresh_feishu.NOTE_PHRASE_RE）或裸 URL，
    # 计数与样例同口径
    bz_not_note = "NOT (coalesce(employer, '') ~ '请到|特此提示|【提示】|更多.*查看' OR coalesce(employer, '') ILIKE '%http%')"
    bz_days = db.execute(text(f"""
        SELECT created_at::date::text d, count(*) c FROM bianzhi_jobs
        WHERE created_at >= :cutoff AND {bz_not_note} GROUP BY 1"""), {"cutoff": cutoff}).all()
    for d, c in bz_days:
        entry = add(d, "bianzhi", c)
        if not entry["bulk"]:
            rows = db.execute(text(f"""
                SELECT id, coalesce(nullif(employer, ''), concat(province, category)) AS title,
                       coalesce(job_type, '') AS sub, coalesce(province, '') AS extra
                FROM bianzhi_jobs WHERE created_at::date = :d AND {bz_not_note}
                ORDER BY id DESC LIMIT :n"""), {"d": d, "n": RECENT_ITEM_MAX}).all()
            entry["items"] = [{"id": r.id, "title": r.title, "sub": r.sub, "extra": r.extra} for r in rows]

    return {
        "days": [
            {"date": d, "boards": by_date[d]}
            for d in sorted(by_date.keys(), reverse=True)
        ],
    }


@app.get("/api/positions", response_model=schemas.PositionList)
@cache.cached("positions", ttl=300)
def get_positions(
    year: Optional[List[int]] = Query(None),
    job_type: Optional[List[str]] = Query(None),
    exam_type: Optional[List[str]] = Query(None),
    exam_type_norm: Optional[List[str]] = Query(None),
    province: Optional[List[str]] = Query(None),
    edu_requirement: Optional[List[str]] = Query(None),
    work_location: Optional[List[str]] = Query(None),
    keyword: Optional[str] = Query(None),
    location: Optional[List[str]] = Query(None),
    edu_level: Optional[List[str]] = Query(None),
    major: Optional[str] = Query(None),
    major_type: Optional[str] = Query("any"),
    category: Optional[List[str]] = Query(None),
    hide_expired: bool = Query(False),
    created_after: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    sort: str = Query("year_desc"),
    after_id: Optional[int] = Query(None, ge=0),
    after_year: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    filters = _build_filter(
        year=year,
        job_type=job_type,
        exam_type=exam_type,
        exam_type_norm=exam_type_norm,
        province=province,
        edu_requirement=edu_requirement,
        work_location=work_location,
        keyword=keyword,
        location=location,
        edu_level=edu_level,
        major=major,
        major_type=major_type,
        category=category,
        hide_expired=hide_expired,
        created_after=created_after,
    )
    try:
        if after_id is not None:
            items = crud.search_positions_cursor(db, filters, after_id, after_year, page_size, sort)
            return {
                "total": -1,
                "page": page,
                "page_size": page_size,
                "next_cursor": items[-1].id if items else None,
                "items": [schemas.PositionOut.model_validate(item).model_dump() for item in items],
            }
        meta: dict = {}
        total, items = crud.search_positions(db, filters, page, page_size, sort, meta=meta)
    except OperationalError as e:
        if not _is_query_canceled(e):
            raise
        db.rollback()
        try:
            # 重试一次：首次执行已预热缓冲区，重试通常可在限时内完成
            meta = {}
            total, items = crud.search_positions(db, filters, page, page_size, sort, meta=meta)
        except OperationalError as e2:
            if not _is_query_canceled(e2):
                raise
            # 两次均被取消：降级为空结果而非 500（timed_out 响应不入缓存）
            db.rollback()
            return {
                "total": 0,
                "total_capped": False,
                "page": page,
                "page_size": page_size,
                "next_cursor": None,
                "items": [],
                "timed_out": True,
                "total_partial": True,
            }
    return {
        "total": total,
        "total_capped": total >= crud.COUNT_CAP,
        "page": page,
        "page_size": page_size,
        "next_cursor": None,
        "items": [schemas.PositionOut.model_validate(item).model_dump() for item in items],
        # tier3/count 超时降级：仅标题/单位命中结果，响应不入缓存
        "timed_out": bool(meta.get("timed_out")),
        # count 超时降级：total 为「至少 N 条」部分值，后台正在补算精确值
        "total_partial": bool(meta.get("total_partial")),
    }


@app.get("/api/positions/competition")
@cache.cached("pos_comp", ttl=3600)
def position_competition(
    province: str = Query(..., max_length=30),
    exam_type: str = Query(..., max_length=50),
    year: int = Query(..., ge=2000, le=2100),
    db: Session = Depends(get_db),
):
    """同岗位组横向参考：同省+同考试类型+同年份岗位数及不限专业占比（1h 缓存）。"""
    row = db.execute(
        text("""
            SELECT count(*) AS total,
                   count(*) FILTER (
                       WHERE raw_major ILIKE '%不限%'
                          OR undergrad_major ILIKE '%不限%'
                          OR grad_major ILIKE '%不限%'
                   ) AS unlimited
            FROM positions
            WHERE dup_of_id IS NULL AND invalid_reason IS NULL
              AND province = :p AND exam_type_norm = :e AND year = :y
        """),
        {"p": province, "e": exam_type, "y": year},
    ).one()
    return {"total": row.total, "unlimited_major": row.unlimited}


@app.get("/api/positions/employer-history")
@cache.cached("pos_emp_hist", ttl=3600)
def position_employer_history(
    employer: str = Query(..., min_length=2, max_length=300),
    db: Session = Depends(get_db),
):
    """同单位历年招录：按年份聚合岗位条数及学历要求分布（1h 缓存）。"""
    rows = db.execute(
        text("""
            SELECT year, count(*) AS total
            FROM positions
            WHERE dup_of_id IS NULL AND invalid_reason IS NULL
              AND employer = :emp
            GROUP BY year
            ORDER BY year DESC
            LIMIT 10
        """),
        {"emp": employer},
    ).all()
    years = [r.year for r in rows]
    edu_map: dict = {}
    if years:
        edu_rows = db.execute(
            text("""
                SELECT year, edu_level_norm, count(*) AS n
                FROM positions
                WHERE dup_of_id IS NULL AND invalid_reason IS NULL
                  AND employer = :emp AND year = ANY(:ys)
                  AND edu_level_norm IS NOT NULL AND edu_level_norm <> ''
                GROUP BY year, edu_level_norm
            """),
            {"emp": employer, "ys": years},
        ).all()
        for r in edu_rows:
            edu_map.setdefault(r.year, []).append({"level": r.edu_level_norm, "count": r.n})
    for m in edu_map.values():
        m.sort(key=lambda x: -x["count"])
    return {"years": [
        {"year": r.year, "total": r.total, "edu": edu_map.get(r.year, [])} for r in rows
    ]}


#: 竞争热度分位判定阈值：样本不足（同类岗位数或近7日总浏览过小）时不给结论
HEAT_MIN_PEERS = 20
HEAT_MIN_VIEWS = 100


@app.get("/api/positions/{position_id}/heat")
@cache.cached("pos_heat", ttl=600)
def position_heat(position_id: int, db: Session = Depends(get_db)):
    """竞争热度：该岗近 7 日站内浏览量在同类岗位组（同省×同考试类型×同年）的分位（10min 缓存）。"""
    item = crud.get_position(db, position_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Position not found")
    row = db.execute(
        text("""
            SELECT COALESCE(SUM(v.views), 0) AS views
            FROM metrics_job_view_daily v
            WHERE v.board = 'positions' AND v.job_id = :id
              AND v.day >= CURRENT_DATE - 6
        """),
        {"id": position_id},
    ).one()
    views_7d = int(row.views)
    out = {"views_7d": views_7d, "sample_ok": False, "percentile": None, "level": None,
           "peers": 0, "peer_views": 0}
    if not item.province or not item.exam_type_norm or not item.year:
        return out
    peer = db.execute(
        text("""
            SELECT count(*) AS peers,
                   COALESCE(SUM(t.views), 0) AS peer_views,
                   count(*) FILTER (WHERE t.views < :mine) AS below
            FROM (
                SELECT v.job_id, SUM(v.views) AS views
                FROM metrics_job_view_daily v
                JOIN positions p ON p.id = v.job_id
                WHERE v.board = 'positions' AND v.day >= CURRENT_DATE - 6
                  AND p.dup_of_id IS NULL AND p.invalid_reason IS NULL
                  AND p.province = :prov AND p.exam_type_norm = :et AND p.year = :y
                GROUP BY v.job_id
            ) t
        """),
        {"mine": views_7d, "prov": item.province, "et": item.exam_type_norm, "y": item.year},
    ).one()
    peers, peer_views = int(peer.peers), int(peer.peer_views)
    out["peers"], out["peer_views"] = peers, peer_views
    if peers < HEAT_MIN_PEERS or peer_views < HEAT_MIN_VIEWS or views_7d <= 0:
        return out
    pct = round(int(peer.below) * 100 / peers)
    out["sample_ok"] = True
    out["percentile"] = pct
    out["level"] = "high" if pct >= 80 else ("mid" if pct >= 40 else "low")
    return out


@app.get("/api/positions/{position_id}", response_model=schemas.PositionOut)
def get_position(position_id: int, db: Session = Depends(get_db)):
    item = crud.get_position(db, position_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Position not found")
    return schemas.PositionOut.model_validate(item)


_EDU_ORDER = ["大专/中专", "本科", "硕士研究生", "博士研究生"]


@app.get("/api/positions/{position_id}/similar", response_model=List[schemas.PositionOut])
@cache.cached("pos_similar", ttl=600)
def get_similar_positions(position_id: int, db: Session = Depends(get_db)):
    """相似岗位：同省份 + 同考试类型 + 学历相近（同级或 ±1 级），最多 5 条。"""
    item = crud.get_position(db, position_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Position not found")
    q = db.query(models.Position).filter(
        models.Position.id != position_id,
        models.Position.dup_of_id.is_(None),
        models.Position.invalid_reason.is_(None),
    )
    if item.province:
        q = q.filter(models.Position.province == item.province)
    if item.exam_type_norm:
        q = q.filter(models.Position.exam_type_norm == item.exam_type_norm)
    if item.edu_level_norm in _EDU_ORDER:
        i = _EDU_ORDER.index(item.edu_level_norm)
        near = _EDU_ORDER[max(0, i - 1) : i + 2] + ["其他/不限"]
        q = q.filter(models.Position.edu_level_norm.in_(near))
    items = q.order_by(models.Position.year.desc(), models.Position.id.desc()).limit(5).all()
    return [schemas.PositionOut.model_validate(p).model_dump() for p in items]


@app.get("/api/sources", response_model=schemas.PositionList)
@cache.cached("sources", ttl=300)
def get_sources(
    year: Optional[List[int]] = Query(None),
    job_type: Optional[List[str]] = Query(None),
    exam_type: Optional[List[str]] = Query(None),
    edu_requirement: Optional[List[str]] = Query(None),
    work_location: Optional[List[str]] = Query(None),
    keyword: Optional[str] = Query(None),
    location: Optional[List[str]] = Query(None),
    edu_level: Optional[List[str]] = Query(None),
    major: Optional[str] = Query(None),
    major_type: Optional[str] = Query("any"),
    category: Optional[List[str]] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    filters = _build_filter(
        year=year,
        job_type=job_type,
        exam_type=exam_type,
        edu_requirement=edu_requirement,
        work_location=work_location,
        keyword=keyword,
        location=location,
        edu_level=edu_level,
        major=major,
        major_type=major_type,
        category=category,
    )
    total, items = crud.search_sources(db, filters, page, page_size)
    return {
        "total": total,
        "total_capped": total >= crud.COUNT_CAP,
        "page": page,
        "page_size": page_size,
        "items": [schemas.PositionOut.model_validate(item).model_dump() for item in items],
    }


@app.get("/api/filters", response_model=schemas.FilterOptions)
@cache.cached("filters", ttl=86400, stale=True)
def get_filters(db: Session = Depends(get_db)):
    return crud.get_filter_options(db)


@app.get("/api/suggest", response_model=schemas.SuggestOut)
@cache.cached("suggest", ttl=600)
def suggest(
    q: str = Query(..., min_length=1, max_length=50),
    board: Optional[str] = Query(None, pattern="^(positions|campus|bianzhi)$"),
    limit: int = Query(8, ge=1, le=8),
    db: Session = Depends(get_db),
):
    """搜索联想：热门关键词 + 单位/公司名前缀 + 岗位类别词表（10 分钟缓存，key 含 q+board）。"""
    return {"query": q, "suggestions": crud.suggest_mixed(db, q, board=board, limit=limit)}


@app.get("/api/stats", response_model=schemas.StatsOut)
@cache.cached("stats", ttl=86400, stale=True)
def stats(db: Session = Depends(get_db)):
    return crud.get_stats(db)


@app.get("/api/deadlines", response_model=schemas.PositionList)
@cache.cached("deadlines", ttl=300)
def deadlines(
    days: int = Query(7, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    items = crud.upcoming_deadlines(db, days=days, limit=limit)
    return {
        "total": len(items),
        "page": 1,
        "page_size": limit,
        "next_cursor": None,
        "items": [schemas.PositionOut.model_validate(item).model_dump() for item in items],
    }


@app.get("/api/recommend", response_model=schemas.RecommendOut)
@cache.cached("recommend", ttl=300)
def recommend(
    major: str = Query(..., min_length=1, max_length=50),
    edu_level: Optional[List[str]] = Query(None),
    location: Optional[List[str]] = Query(None),
    category: Optional[List[str]] = Query(None),
    year: Optional[List[int]] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    filters = _build_filter(
        year=year, edu_level=edu_level, location=location, category=category
    )
    items, terms = crud.recommend_positions(db, major, filters, limit)
    out = []
    for item in items:
        d = schemas.PositionOut.model_validate(item).model_dump()
        d["match_score"] = getattr(item, "match_score", 1)
        out.append(d)
    return {"major": major, "expanded_terms": terms, "total": len(out), "items": out}


def _rate_limit(request: Request, bucket: str, limit: int, window: int = 60):
    """基于 Redis 的简单滑窗限流：同一 IP 在 window 秒内最多 limit 次。"""
    ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "unknown")
    key = f"rl:{bucket}:{ip}"
    try:
        r = cache.get_redis()
        n = r.incr(key)
        if n == 1:
            r.expire(key, window)
        if n > limit:
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    except HTTPException:
        raise
    except Exception:
        pass  # Redis 不可用时不阻断请求


@app.get("/api/export")
def export_positions(
    request: Request,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),  # 同步快路径：仅限小导出
    year: Optional[List[int]] = Query(None),
    job_type: Optional[List[str]] = Query(None),
    exam_type: Optional[List[str]] = Query(None),
    exam_type_norm: Optional[List[str]] = Query(None),
    province: Optional[List[str]] = Query(None),
    edu_requirement: Optional[List[str]] = Query(None),
    work_location: Optional[List[str]] = Query(None),
    keyword: Optional[str] = Query(None),
    location: Optional[List[str]] = Query(None),
    edu_level: Optional[List[str]] = Query(None),
    major: Optional[str] = Query(None),
    major_type: Optional[str] = Query("any"),
    category: Optional[List[str]] = Query(None),
    sort: str = Query("year_desc"),
    max_rows: int = Query(2000, ge=1, le=50000),
    fname: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    _rate_limit(request, "export", limit=3, window=60)
    max_rows = min(max_rows, SYNC_EXPORT_MAX_ROWS)  # 大导出请用 POST /api/export 异步任务
    filters = _build_filter(
        year=year,
        job_type=job_type,
        exam_type=exam_type,
        exam_type_norm=exam_type_norm,
        province=province,
        edu_requirement=edu_requirement,
        work_location=work_location,
        keyword=keyword,
        location=location,
        edu_level=edu_level,
        major=major,
        major_type=major_type,
        category=category,
    )
    # 先物化再流式输出：避免查询在响应体中途被 statement_timeout 取消，
    # 客户端拿到只有表头的“成功”文件；被取消时重试一次，仍失败则返回明确错误
    try:
        rows = list(crud.export_positions(db, filters, sort=sort, max_rows=max_rows))
    except OperationalError as e:
        if not _is_query_canceled(e):
            raise
        db.rollback()
        try:
            rows = list(crud.export_positions(db, filters, sort=sort, max_rows=max_rows))
        except OperationalError as e2:
            if not _is_query_canceled(e2):
                raise
            db.rollback()
            raise HTTPException(status_code=503, detail="导出查询超时，请稍后重试或收窄筛选范围")
    cols = crud.EXPORT_COLUMNS
    filename = csv_export.safe_fname(fname, f"positions_{datetime.now().strftime('%Y%m%d_%H%M%S')}")

    if format == "csv":
        return csv_export.stream_csv(rows, cols, filename)

    # xlsx
    data = [[getattr(pos, attr, "") or "" for attr, _ in cols] for pos in rows]
    df = pd.DataFrame(data, columns=[label for _, label in cols])
    out = io.BytesIO()
    with pd.ExcelWriter(out, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="岗位")
    out.seek(0)
    return StreamingResponse(
        out,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}.xlsx"},
    )


@app.post("/api/export")
def create_export(
    request: Request,
    body: schemas.ExportRequest,
):
    """异步导出：创建 Celery 任务，返回 task_id；文件写到 exports/，24h 后自动清理。"""
    _rate_limit(request, "export", limit=3, window=60)
    if body.format not in ("csv", "xlsx"):
        raise HTTPException(status_code=422, detail="format 仅支持 csv/xlsx")
    max_rows = max(1, min(body.max_rows, 50000))
    if body.board in ("campus", "bianzhi"):
        board_filters = body.campus if body.board == "campus" else body.bianzhi
        task = export_board_task.delay(
            body.board,
            board_filters.model_dump(exclude_none=True) if board_filters else {},
            fname=body.fname,
            max_rows=max_rows,
        )
        return {"task_id": task.id, "status": "started"}
    if body.board != "positions":
        raise HTTPException(status_code=422, detail="board 仅支持 positions/campus/bianzhi")
    filters = body.model_dump(
        exclude={"format", "sort", "max_rows", "board", "campus", "bianzhi", "fname"},
        exclude_none=True,
    )
    task = export_positions_task.delay(
        filters, format=body.format, sort=body.sort, max_rows=max_rows, fname=body.fname,
    )
    return {"task_id": task.id, "status": "started"}


@app.get("/api/export/status/{task_id}")
def export_status(task_id: str):
    result = celery_app.AsyncResult(task_id)
    out = {"task_id": task_id, "status": result.status}
    if result.successful() and isinstance(result.result, dict):
        out.update(result.result)
    elif result.failed():
        out["error"] = str(result.result)[:500]
    return out


@app.get("/api/export/download/{task_id}")
def export_download(task_id: str):
    result = celery_app.AsyncResult(task_id)
    if not result.successful() or not isinstance(result.result, dict):
        raise HTTPException(status_code=404, detail="导出任务未完成或不存在")
    fname = os.path.basename(result.result.get("file", ""))
    path = os.path.join(EXPORTS_DIR, fname)
    if not fname or not os.path.isfile(path):
        raise HTTPException(status_code=410, detail="导出文件已过期清理，请重新导出")
    media = (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if fname.endswith(".xlsx") else "text/csv; charset=utf-8"
    )
    return FileResponse(path, media_type=media, filename=fname)


FEEDBACK_BOARDS = {"positions", "campus", "bianzhi"}
FEEDBACK_ISSUE_TYPES = {"link_broken", "wrong_info", "expired", "other"}


PV_BOARD_RE = re.compile(r"^[a-z][a-z0-9_-]{0,29}$")

#: 留存埋点事件类型（board="event" 时 page 仅允许这些值）
METRIC_EVENTS = {"remind_set", "save_filter", "new_since_click", "apply_click", "apply_marked"}


@app.post("/api/metrics/pv")
def report_pv(request: Request, body: schemas.PvIn, db: Session = Depends(get_db)):
    """自建轻量访问统计：日聚合 PV + 独立会话估算（无 cookie，IP 不落库）。"""
    _rate_limit(request, "pv", limit=60, window=60)
    board = (body.board or "").strip()
    if not PV_BOARD_RE.match(board):
        raise HTTPException(status_code=422, detail="board 无效")
    page = (body.page or "").strip()[:50]
    if board == "event" and page not in METRIC_EVENTS:
        raise HTTPException(status_code=422, detail="event 无效")
    db.execute(text("""
        INSERT INTO metrics_pv_daily (day, board, page, pv)
        VALUES (CURRENT_DATE, :b, :p, 1)
        ON CONFLICT (day, board, page) DO UPDATE SET pv = metrics_pv_daily.pv + 1
    """), {"b": board, "p": page})
    sid = (body.sid or "").strip()[:40]
    if sid:
        db.execute(text("""
            INSERT INTO metrics_sessions_daily (day, sid)
            VALUES (CURRENT_DATE, :s) ON CONFLICT (day, sid) DO NOTHING
        """), {"s": sid})
    db.commit()
    return {"ok": True}


JOB_VIEW_BOARDS = {"positions", "campus", "bianzhi"}


@app.post("/api/metrics/job-view")
def report_job_view(request: Request, body: schemas.JobViewIn, db: Session = Depends(get_db)):
    """岗位级浏览上报：详情面板打开时按日聚合计数（无 cookie，IP 不落库）。"""
    _rate_limit(request, "jobview", limit=60, window=60)
    if body.board not in JOB_VIEW_BOARDS:
        raise HTTPException(status_code=422, detail="board 无效")
    if body.job_id <= 0:
        raise HTTPException(status_code=422, detail="job_id 无效")
    db.execute(text("""
        INSERT INTO metrics_job_view_daily (day, board, job_id, views)
        VALUES (CURRENT_DATE, :b, :j, 1)
        ON CONFLICT (day, board, job_id) DO UPDATE SET views = metrics_job_view_daily.views + 1
    """), {"b": body.board, "j": body.job_id})
    db.commit()
    return {"ok": True}


@app.post("/api/feedback")
def create_feedback(request: Request, body: schemas.FeedbackIn, db: Session = Depends(get_db)):
    """用户「举报数据有误」：写入 feedback 表，管理后台数据质量卡查看处理。"""
    _rate_limit(request, "feedback", limit=5, window=60)
    if body.board not in FEEDBACK_BOARDS:
        raise HTTPException(status_code=422, detail="board 仅支持 positions/campus/bianzhi")
    if body.issue_type not in FEEDBACK_ISSUE_TYPES:
        raise HTTPException(status_code=422, detail="issue_type 无效")
    note = (body.note or "").strip()[:500] or None
    ua = (request.headers.get("user-agent") or "")[:300] or None
    fb = models.Feedback(
        board=body.board, item_id=body.item_id, issue_type=body.issue_type, note=note, ua=ua
    )
    db.add(fb)
    db.commit()
    return {"ok": True, "id": fb.id}


@app.post(
    "/api/admin/scrape/{year}",
    response_model=schemas.TaskOut,
    dependencies=[Depends(require_admin)],
)
def trigger_scrape(year: int):
    if year not in (2025, 2026, 2027):
        raise HTTPException(status_code=422, detail="仅支持 2025-2027 年份")
    task = scrape_year.delay(year)
    return {"task_id": task.id, "status": "started"}


@app.get("/api/admin/task/{task_id}", dependencies=[Depends(require_admin)])
def task_status(task_id: str):
    result = celery_app.AsyncResult(task_id)
    return {"task_id": task_id, "status": result.status, "info": result.info}


dist_dir = os.path.join(os.path.dirname(__file__), "../frontend/dist")
if os.path.isdir(dist_dir):
    index_path = os.path.join(dist_dir, "index.html")

    @app.get("/", include_in_schema=False)
    def index_html_route(request: Request, db: Session = Depends(get_db)):
        """带 ?job=board:id 时注入岗位 meta（分享卡片），否则原样返回 index.html。"""
        job_key = request.query_params.get("job")
        meta = None
        if job_key:
            try:
                meta = share_meta.get_share_meta(db, job_key)
            except Exception:
                meta = None
        if not meta:
            meta = share_meta.get_search_meta(request.query_params)
        if meta:
            with open(index_path, encoding="utf-8") as f:
                raw = f.read()
            return HTMLResponse(share_meta.inject_meta(raw, meta["title"], meta["desc"]))
        return FileResponse(index_path, media_type="text/html")

    @app.middleware("http")
    async def static_cache_headers(request: Request, call_next):
        """带 hash 的 /assets/* 长缓存 immutable；HTML/SW 走 no-cache 协商，保证发版即时生效。"""
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path == "/sw.js" or path.endswith(".html") or path == "/":
            response.headers.setdefault("Cache-Control", "no-cache")
        return response

    class SpaStaticFiles(StaticFiles):
        """未知路径的 HTML GET 请求回落到 index.html（404 状态），避免用户看到裸 JSON。"""

        async def get_response(self, path, scope):
            try:
                response = await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code == 404 and scope["method"] in ("GET", "HEAD"):
                    return FileResponse(index_path, media_type="text/html", status_code=404)
                raise
            if response.status_code == 404 and scope["method"] in ("GET", "HEAD"):
                return FileResponse(index_path, media_type="text/html", status_code=404)
            return response

    app.mount("/", SpaStaticFiles(directory=dist_dir, html=True), name="static")
else:
    @app.get("/")
    def root():
        return {"message": "Frontend not built yet. Please run npm run build in frontend."}
