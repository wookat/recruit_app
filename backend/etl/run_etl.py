# -*- coding: utf-8 -*-
"""Data quality ETL for the positions table (1.36M rows).

Additive & reversible: only fills new columns and marks duplicates/invalid rows
(dup_of_id / invalid_reason); never physically deletes. Query positions_clean
for the deduplicated view.

Usage:
    python backend/etl/run_etl.py --steps schema,normalize,dedupe,invalid [--dry-run] [--batch-size 20000] [--db postgresql://...]

Steps:
    schema     apply migration_001_schema.sql (additive columns + view)
    normalize  fill content_hash_v2, exam_type_norm, province/city/district,
               location_tags (v2), undergrad/grad/college_major
    dedupe     mark dup_of_id: rows sharing content_hash_v2 keep min(id)
    invalid    mark invalid_reason for rows unusable for search
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text

from etl.normalize_v2 import (
    clean_employer, content_hash_v2, normalize_exam_type, parse_location, split_major,
)

SCHEMA_SQL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migration_001_schema.sql")

SELECT_COLS = [
    "id", "year", "job_type", "exam_type", "employer", "position_example",
    "edu_requirement", "undergrad_major", "grad_major", "exam_form",
    "signup_time", "exam_time", "special_requirements", "work_location",
    "raw_major",
]

UPDATE_SQL = text("""
    UPDATE positions SET
        content_hash_v2 = :h,
        employer = :emp,
        exam_type_norm = :etn,
        province = :prov, city = :city, district = :district,
        location_tags = :tags,
        undergrad_major = :ug, grad_major = :g, college_major = :col
    WHERE id = :id
""")

DEDUPE_SQL = text("""
    WITH ranked AS (
        SELECT id, MIN(id) OVER (PARTITION BY content_hash_v2) AS keep_id
        FROM positions
        WHERE content_hash_v2 IS NOT NULL
    )
    UPDATE positions p
    SET dup_of_id = r.keep_id
    FROM ranked r
    WHERE p.id = r.id AND r.id <> r.keep_id AND p.dup_of_id IS DISTINCT FROM r.keep_id
""")

INVALID_SQL = text("""
    UPDATE positions SET invalid_reason = CASE
        WHEN (employer IS NULL OR employer = '') AND (position_example IS NULL OR position_example = '')
            THEN 'no_employer_no_position'
        WHEN year IS NULL OR year < 2000 OR year > 2100 THEN 'bad_year'
        ELSE NULL END
    WHERE invalid_reason IS NULL
""")


def step_schema(engine, dry_run):
    with open(SCHEMA_SQL, encoding="utf-8") as f:
        sql = f.read()
    if dry_run:
        print("[dry-run] would apply migration_001_schema.sql")
        return
    with engine.begin() as conn:
        conn.execute(text(sql))
    print("schema applied")


def step_normalize(engine, dry_run, batch_size, where="TRUE"):
    cols = ", ".join(SELECT_COLS)
    with engine.connect() as conn:
        total = conn.execute(text(f"SELECT count(*) FROM positions WHERE {where}")).scalar()
    print(f"normalize: {total} rows")
    last_id, done, t0 = 0, 0, time.time()
    while True:
        with engine.connect() as conn:
            rows = conn.execute(text(
                f"SELECT {cols} FROM positions WHERE id > :last AND {where} ORDER BY id LIMIT :lim"
            ), {"last": last_id, "lim": batch_size}).mappings().all()
        if not rows:
            break
        params = []
        for r in rows:
            rec = dict(r)
            rec["employer"] = clean_employer(rec.get("employer"))
            ug, g, col = split_major(rec.get("raw_major"), rec.get("undergrad_major"), rec.get("grad_major"))
            rec["undergrad_major"], rec["grad_major"] = ug, g
            prov, city, district, tags = parse_location(rec.get("work_location"))
            params.append({
                "id": rec["id"],
                "h": content_hash_v2(rec),
                "emp": rec["employer"],
                "etn": normalize_exam_type(rec.get("exam_type")),
                "prov": prov, "city": city, "district": district,
                "tags": tags,
                "ug": ug, "g": g, "col": col,
            })
        last_id = rows[-1]["id"]
        if dry_run:
            done += len(rows)
            if done <= batch_size:
                for p in params[:5]:
                    print("[dry-run sample]", p)
        else:
            with engine.begin() as conn:
                conn.execute(UPDATE_SQL, params)
            done += len(rows)
        print(f"  normalize {done}/{total} ({done * 100 // max(total, 1)}%) {time.time() - t0:.0f}s")
    print("normalize done")


def step_dedupe(engine, dry_run):
    if dry_run:
        with engine.connect() as conn:
            n = conn.execute(text(
                "SELECT count(*) - count(DISTINCT content_hash_v2) FROM positions WHERE content_hash_v2 IS NOT NULL"
            )).scalar()
        print(f"[dry-run] would mark {n} rows as duplicates")
        return
    with engine.begin() as conn:
        res = conn.execute(DEDUPE_SQL)
    print(f"dedupe: marked {res.rowcount} rows (dup_of_id)")


def step_invalid(engine, dry_run):
    if dry_run:
        with engine.connect() as conn:
            n = conn.execute(text(
                "SELECT count(*) FROM positions WHERE invalid_reason IS NULL AND ("
                "((employer IS NULL OR employer='') AND (position_example IS NULL OR position_example='')) "
                "OR year IS NULL OR year < 2000 OR year > 2100)"
            )).scalar()
        print(f"[dry-run] would mark {n} rows invalid")
        return
    with engine.begin() as conn:
        res = conn.execute(INVALID_SQL)
    print(f"invalid: marked rows (scan touched {res.rowcount})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.environ.get("DATABASE_URL"))
    ap.add_argument("--steps", default="schema,normalize,dedupe,invalid")
    ap.add_argument("--batch-size", type=int, default=20000)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--where", default="TRUE", help="extra WHERE filter for normalize step")
    args = ap.parse_args()

    db_url = args.db
    if not db_url:
        from database import DATABASE_URL as db_url  # fallback to app config
    engine = create_engine(db_url)

    steps = [s.strip() for s in args.steps.split(",") if s.strip()]
    for s in steps:
        if s == "schema":
            step_schema(engine, args.dry_run)
        elif s == "normalize":
            step_normalize(engine, args.dry_run, args.batch_size, args.where)
        elif s == "dedupe":
            step_dedupe(engine, args.dry_run)
        elif s == "invalid":
            step_invalid(engine, args.dry_run)
        else:
            raise SystemExit(f"unknown step: {s}")


if __name__ == "__main__":
    main()
