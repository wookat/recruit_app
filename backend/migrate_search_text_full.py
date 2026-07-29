#!/usr/bin/env python3
"""Recompute search_text for all rows (use after ETL changes undergrad/grad/major)."""
import os
import time

from sqlalchemy import create_engine, text

DB_URL = os.getenv("DATABASE_URL", "postgresql://recruit:recruit@localhost:5432/recruit")
engine = create_engine(DB_URL, future=True)


def main():
    with engine.connect() as conn:
        print("creating GIN trigram index...")
        conn.execute(text("DROP INDEX IF EXISTS idx_pos_search_text"))
        conn.execute(text("CREATE INDEX idx_pos_search_text ON positions USING GIN (search_text gin_trgm_ops)"))
        conn.commit()

        print("populating search_text (batched)...")
        batch_size = 50000
        last_id = 0
        total = 0
        t0 = time.time()
        while True:
            result = conn.execute(
                text(
                    """
                    WITH to_update AS (
                        SELECT id FROM positions
                        WHERE id > :last_id
                        ORDER BY id
                        LIMIT :batch_size
                    )
                    UPDATE positions p
                    SET search_text = COALESCE(position_example, '') || ' ' ||
                                      COALESCE(employer, '') || ' ' ||
                                      COALESCE(exam_type, '') || ' ' ||
                                      COALESCE(exam_type_norm, '') || ' ' ||
                                      COALESCE(job_type, '') || ' ' ||
                                      COALESCE(undergrad_major, '') || ' ' ||
                                      COALESCE(grad_major, '') || ' ' ||
                                      COALESCE(college_major, '') || ' ' ||
                                      COALESCE(raw_major, '') || ' ' ||
                                      COALESCE(special_requirements, '') || ' ' ||
                                      COALESCE(work_location, '') || ' ' ||
                                      COALESCE(province, '') || ' ' ||
                                      COALESCE(city, '') || ' ' ||
                                      COALESCE(district, '') || ' ' ||
                                      COALESCE(notes, '')
                    FROM to_update t
                    WHERE p.id = t.id
                    """
                ),
                {"last_id": last_id, "batch_size": batch_size},
            )
            n = result.rowcount
            conn.commit()
            total += n
            if n == 0:
                break
            row = conn.execute(
                text("SELECT MAX(id) FROM (SELECT id FROM positions WHERE id > :last_id ORDER BY id LIMIT :batch_size) sub"),
                {"last_id": last_id, "batch_size": batch_size},
            ).fetchone()
            last_id = row[0] or 0
            print(f"  updated {total} rows  ({time.time()-t0:.1f}s)")
        print(f"populated {total} rows in {time.time()-t0:.1f}s")

        print("analyzing positions...")
        conn.execute(text("ANALYZE positions"))
        conn.commit()
        print("done")


if __name__ == "__main__":
    main()
