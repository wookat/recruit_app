import os
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
@cache.cached("positions", ttl=30)
def get_positions(
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
    sort: str = Query("year_desc"),
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
    total, items = crud.search_positions(db, filters, page, page_size, sort)
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [schemas.PositionOut.model_validate(item).model_dump() for item in items],
    }


@app.get("/api/sources", response_model=schemas.PositionList)
@cache.cached("sources", ttl=30)
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
@cache.cached("filters", ttl=60)
def get_filters(db: Session = Depends(get_db)):
    return crud.get_filter_options(db)


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
