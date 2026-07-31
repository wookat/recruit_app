import csv
import io
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional

import pandas as pd
from fastapi import FastAPI, Depends, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import engine, Base, get_db
from celery_app import celery_app
import crud
import schemas
import cache
from admin import require_admin, router as admin_router
from campus import router as campus_router
from bianzhi import router as bianzhi_router
from tasks import EXPORTS_DIR, export_positions_task, scrape_year


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
    )


@app.get("/api/health")
def health():
    return {"ok": True}


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
    )
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
    rows = crud.export_positions(db, filters, sort=sort, max_rows=max_rows)
    cols = crud.EXPORT_COLUMNS
    filename = f"positions_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    if format == "csv":
        def iter_csv():
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow([label for _, label in cols])
            yield "\ufeff" + buf.getvalue()  # BOM for Excel compatibility
            for pos in rows:
                buf.seek(0)
                buf.truncate(0)
                writer.writerow([getattr(pos, attr, "") or "" for attr, _ in cols])
                yield buf.getvalue()

        return StreamingResponse(
            iter_csv(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
        )

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
        headers={"Content-Disposition": f'attachment; filename="{filename}.xlsx"'},
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
    filters = body.model_dump(exclude={"format", "sort", "max_rows"}, exclude_none=True)
    task = export_positions_task.delay(
        filters, format=body.format, sort=body.sort,
        max_rows=max(1, min(body.max_rows, 50000)),
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
    app.mount("/", StaticFiles(directory=dist_dir, html=True), name="static")
else:
    @app.get("/")
    def root():
        return {"message": "Frontend not built yet. Please run npm run build in frontend."}
