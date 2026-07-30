import os
import re
import sys
import hashlib
import argparse
import pandas as pd
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.dialects.postgresql import insert

sys.path.insert(0, os.path.dirname(__file__))
from database import Base, SessionLocal
from models import Position, Source
from normalizer import normalize_edu, normalize_job_type, parse_location_tags
from etl.normalize_v2 import (
    clean_employer,
    content_hash_v2,
    normalize_exam_type,
    parse_location,
    parse_signup_deadline,
    split_major,
)


def _clean(val):
    if pd.isna(val):
        return None
    s = str(val).strip()
    return s if s and s.lower() != "nan" else None


def _extract_year(text):
    if not text:
        return None
    m = re.match(r"(\d{4})", str(text))
    return int(m.group(1)) if m else None


_POS_MAPPING = {
    "year": "year",
    "工作类型": "job_type",
    "考试/招聘类型": "exam_type",
    "用人单位/系统": "employer",
    "岗位示例": "position_example",
    "学历要求": "edu_requirement",
    "本科生专业要求": "undergrad_major",
    "研究生专业要求": "grad_major",
    "考试/招聘形式": "exam_form",
    "报名时间": "signup_time",
    "笔试/考试时间": "exam_time",
    "特殊要求": "special_requirements",
    "工作地点": "work_location",
    "信息来源": "source_url",
    "备注": "notes",
    "专业要求（原始）": "raw_major",
}


def _row_to_record(row, mapping, default_year=None):
    rec = {}
    for col, key in mapping.items():
        if col == "year":
            val = row.get(col)
            if pd.isna(val) or val is None:
                val = _extract_year(row.get("考试/招聘类型")) or default_year
            rec[key] = int(val) if val is not None else None
        else:
            rec[key] = _clean(row.get(col))
    return rec


def _compute_hash(rec):
    keys = [
        "year", "job_type", "exam_type", "employer", "position_example",
        "edu_requirement", "edu_level_norm", "undergrad_major", "grad_major", "exam_form",
        "signup_time", "exam_time", "special_requirements", "work_location",
        "source_url", "notes", "raw_major",
    ]
    s = "|".join(str(rec.get(k, "")) for k in keys)
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def _build_search_text(rec: dict) -> str:
    parts = []
    for k in ("position_example", "employer", "exam_type", "exam_type_norm", "job_type",
              "undergrad_major", "grad_major", "college_major", "raw_major",
              "special_requirements", "work_location", "province", "city", "district",
              "notes"):
        v = rec.get(k)
        if v:
            parts.append(str(v))
    return " ".join(parts)


def _enrich_record(rec: dict) -> dict:
    rec["job_type"] = normalize_job_type(rec.get("job_type"))
    rec["edu_level_norm"] = normalize_edu(rec.get("edu_requirement"))
    rec["employer"] = clean_employer(rec.get("employer"))
    rec["exam_type_norm"] = normalize_exam_type(rec.get("exam_type"))
    province, city, district, location_tags = parse_location(rec.get("work_location"))
    rec["province"] = province
    rec["city"] = city
    rec["district"] = district
    rec["location_tags"] = location_tags
    rec["undergrad_major"], rec["grad_major"], rec["college_major"] = split_major(
        rec.get("raw_major"), rec.get("undergrad_major"), rec.get("grad_major")
    )
    rec["content_hash_v2"] = content_hash_v2(rec)
    rec["signup_deadline"] = parse_signup_deadline(rec.get("signup_time"))
    rec["search_text"] = _build_search_text(rec)
    return rec


def ingest_positions_df(db, df: pd.DataFrame, default_year=2026):
    records = []
    seen_v2 = set()
    for _, row in df.iterrows():
        rec = _row_to_record(row, _POS_MAPPING, default_year)
        if not rec.get("exam_type") and not rec.get("position_example"):
            continue
        rec = _enrich_record(rec)
        rec["content_hash"] = _compute_hash(rec)
        if rec["content_hash_v2"] in seen_v2:
            continue
        seen_v2.add(rec["content_hash_v2"])
        records.append(rec)
    if records:
        # 按 content_hash_v2 预过滤已存在的岗位，避免同岗位换来源 URL 后重复入库
        v2_list = [r["content_hash_v2"] for r in records]
        existing = set()
        for i in range(0, len(v2_list), 5000):
            rows = (
                db.query(Position.content_hash_v2)
                .filter(Position.content_hash_v2.in_(v2_list[i : i + 5000]))
                .all()
            )
            existing.update(h for (h,) in rows)
        records = [r for r in records if r["content_hash_v2"] not in existing]
    if records:
        stmt = insert(Position).values(records)
        stmt = stmt.on_conflict_do_nothing(index_elements=["content_hash"])
        db.execute(stmt)


def ingest_sources_df(db, df: pd.DataFrame):
    records = []
    for _, row in df.iterrows():
        rec = _row_to_record(row, _POS_MAPPING, default_year=None)
        # default year from exam_type; if missing use 2026
        if rec.get("year") is None:
            rec["year"] = 2026
        if not rec.get("exam_type") and not rec.get("position_example"):
            continue
        rec = _enrich_record(rec)
        records.append(rec)
    if records:
        db.bulk_insert_mappings(Source, records)


def ingest_excel(excel_path: str):
    engine_db = create_engine(os.getenv("DATABASE_URL", "postgresql://recruit:recruit@localhost:5432/recruit"))
    with engine_db.connect() as conn:
        from sqlalchemy import text
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        conn.commit()
    Base.metadata.create_all(bind=engine_db)
    db = SessionLocal()
    try:
        print("Reading", excel_path)
        xls = pd.ExcelFile(excel_path)
        print("Sheets:", xls.sheet_names)

        if "全岗位总表" in xls.sheet_names:
            print("Ingesting positions...")
            df = pd.read_excel(xls, sheet_name="全岗位总表", dtype=str)
            db.query(Position).delete()
            ingest_positions_df(db, df)
            db.commit()
            print("Positions inserted:", db.query(Position).count())

        if "官方来源目录" in xls.sheet_names:
            print("Ingesting sources...")
            df = pd.read_excel(xls, sheet_name="官方来源目录", dtype=str)
            db.query(Source).delete()
            ingest_sources_df(db, df)
            db.commit()
            print("Sources inserted:", db.query(Source).count())
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default="/home/ubuntu/2026-2027年全国体制内招录信息汇总（全岗位+来源）.xlsx")
    args = parser.parse_args()
    ingest_excel(args.file)
