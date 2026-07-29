#!/usr/bin/env python3
"""Remove duplicate positions that have identical content fields except source_url/info_url.

Run: .venv/bin/python migrate_dedup.py
"""
import os
import time

from sqlalchemy import create_engine, text

DB_URL = os.getenv("DATABASE_URL", "postgresql://recruit:recruit@localhost:5432/recruit")
engine = create_engine(DB_URL, future=True)

# Columns that define "same position" for deduplication purposes.
# We intentionally exclude id, content_hash, source_url, info_url, notes.
KEY_COLS = [
    "year",
    "job_type",
    "exam_type",
    "employer",
    "position_example",
    "edu_requirement",
    "edu_level_norm",
    "undergrad_major",
    "grad_major",
    "exam_form",
    "signup_time",
    "exam_time",
    "special_requirements",
    "work_location",
    "notes",
    "raw_major",
]


def main():
    with engine.connect() as conn:
        total = conn.execute(text("SELECT count(*) FROM positions")).scalar()
        print(f"before dedup: {total}")

        # Build a deterministic content fingerprint and keep the row with the smallest id.
        def cast(col):
            if col == "year":
                return f"COALESCE({col}::text, '')"
            return f"COALESCE({col}, '')"
        key_sql = ", ".join(cast(c) for c in KEY_COLS)
        print("creating temp dedup table...")
        t0 = time.time()
        conn.execute(text("DROP TABLE IF EXISTS dedup_keep_ids"))
        conn.execute(
            text(
                f"""
            CREATE TABLE dedup_keep_ids AS
            SELECT MIN(id) AS id
            FROM positions
            GROUP BY md5(concat({key_sql}))
            """
            )
        )
        conn.execute(text("CREATE INDEX ON dedup_keep_ids(id)"))
        conn.commit()
        keep = conn.execute(text("SELECT count(*) FROM dedup_keep_ids")).scalar()
        print(f"unique rows to keep: {keep}  ({time.time()-t0:.1f}s)")

        print("creating delete id table...")
        t0 = time.time()
        conn.execute(text("DROP TABLE IF EXISTS dedup_delete_ids"))
        conn.execute(
            text(
                """
            CREATE TABLE dedup_delete_ids AS
            SELECT p.id AS id
            FROM positions p
            LEFT JOIN dedup_keep_ids k ON p.id = k.id
            WHERE k.id IS NULL
            """
            )
        )
        conn.execute(text("CREATE INDEX ON dedup_delete_ids(id)"))
        conn.commit()
        to_delete = conn.execute(text("SELECT count(*) FROM dedup_delete_ids")).scalar()
        print(f"rows to delete: {to_delete}  ({time.time()-t0:.1f}s)")

        print("deleting duplicates...")
        t0 = time.time()
        result = conn.execute(
            text(
                """
            DELETE FROM positions p
            USING dedup_delete_ids d
            WHERE p.id = d.id
            """
            )
        )
        deleted = result.rowcount
        print(f"deleted {deleted} rows  ({time.time()-t0:.1f}s)")

        conn.execute(text("DROP TABLE dedup_keep_ids"))
        conn.execute(text("DROP TABLE dedup_delete_ids"))
        conn.commit()
        print("committed delete")

    # VACUUM cannot run inside a transaction.
    print("running VACUUM ANALYZE...")
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("VACUUM ANALYZE positions"))

    with engine.connect() as conn:
        total_after = conn.execute(text("SELECT count(*) FROM positions")).scalar()
        print(f"after dedup: {total_after}")


if __name__ == "__main__":
    main()
