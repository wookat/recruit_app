import csv
import io
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional

import pandas as pd
from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import engine, Base, get_db
from celery_app import celery_app
import crud
import schemas
import cache
from tasks import scrape_year


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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
        "page": page,
        "page_size": page_size,
        "items": [schemas.PositionOut.model_validate(item).model_dump() for item in items],
    }


@app.get("/api/filters", response_model=schemas.FilterOptions)
@cache.cached("filters", ttl=600)
def get_filters(db: Session = Depends(get_db)):
    return crud.get_filter_options(db)


@app.get("/api/suggest", response_model=schemas.SuggestOut)
@cache.cached("suggest", ttl=300)
def suggest(
    q: str = Query(..., min_length=1, max_length=50),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    return {"query": q, "suggestions": crud.suggest_keywords(db, q, limit)}


@app.get("/api/stats", response_model=schemas.StatsOut)
@cache.cached("stats", ttl=3600)
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


@app.get("/api/export")
def export_positions(
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
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
    max_rows: int = Query(20000, ge=1, le=50000),
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


@app.post("/api/admin/scrape/{year}", response_model=schemas.TaskOut)
def trigger_scrape(year: int):
    task = scrape_year.delay(year)
    return {"task_id": task.id, "status": "started"}


@app.get("/api/admin/task/{task_id}")
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
