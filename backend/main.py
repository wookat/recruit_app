import io
import os
from urllib.parse import quote
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import List, Optional

import pandas as pd
from fastapi import FastAPI, Depends, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
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
from tasks import EXPORTS_DIR, export_board_task, export_positions_task, scrape_year


@asynccontextmanager
async def lifespan(app: FastAPI):
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
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
app.include_router(admin_router)
app.include_router(campus_router)
app.include_router(bianzhi_router)

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
    )


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/freshness")
@cache.cached("freshness", ttl=600)
def data_freshness(db: Session = Depends(get_db)):
    """各数据板块最近一次采集成功时间（crawl_runs 聚合，10 分钟缓存）。"""
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
    return {k: {"last_success": by_grp.get(k)} for k in ("positions", "campus", "bianzhi")}


RECENT_BULK_THRESHOLD = 2000  # 单日入库超过该值视为全量同步导入，不逐条展示
RECENT_ITEM_MAX = 6


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
@cache.cached("positions", ttl=120)
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
        total, items = crud.search_positions(db, filters, page, page_size, sort)
    except OperationalError as e:
        if not _is_query_canceled(e):
            raise
        db.rollback()
        try:
            # 重试一次：首次执行已预热缓冲区，重试通常可在限时内完成
            total, items = crud.search_positions(db, filters, page, page_size, sort)
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
            }
    return {
        "total": total,
        "total_capped": total >= crud.COUNT_CAP,
        "page": page,
        "page_size": page_size,
        "next_cursor": None,
        "items": [schemas.PositionOut.model_validate(item).model_dump() for item in items],
    }


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
@cache.cached("sources", ttl=120)
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
@cache.cached("suggest", ttl=300)
def suggest(
    q: str = Query(..., min_length=2, max_length=50),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    return {"query": q, "suggestions": crud.suggest_keywords(db, q, limit)}


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
        if job_key:
            try:
                meta = share_meta.get_share_meta(db, job_key)
            except Exception:
                meta = None
            if meta:
                with open(index_path, encoding="utf-8") as f:
                    raw = f.read()
                return HTMLResponse(share_meta.inject_meta(raw, meta["title"], meta["desc"]))
        return FileResponse(index_path, media_type="text/html")

    app.mount("/", StaticFiles(directory=dist_dir, html=True), name="static")
else:
    @app.get("/")
    def root():
        return {"message": "Frontend not built yet. Please run npm run build in frontend."}
