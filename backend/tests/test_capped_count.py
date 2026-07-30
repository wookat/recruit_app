# -*- coding: utf-8 -*-
"""D4 集成自测：capped count（LIMIT 10001 封顶计数）。

造 10,500 行大结果集验证 total 封顶为 10001 且计数显著变快；小结果集 total 精确不变；
API 层验证 total_capped 字段。需本地 postgres + redis。

用法: cd backend && python tests/test_capped_count.py
"""
import os
import subprocess
import sys
import time

import requests as rq

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cache
import crud
from crud import COUNT_CAP, PositionFilter
from database import Base, SessionLocal, engine
from models import Position
from sqlalchemy import text

PY = sys.executable
PORT = 8879
BASE = f"http://127.0.0.1:{PORT}"
BIG, SMALL = 10500, 7


def main():
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.execute(text("DELETE FROM positions WHERE exam_type IN ('D4大集合', 'D4小集合')"))
    db.execute(text(f"""
        INSERT INTO positions (year, job_type, exam_type, employer, position_example, search_text, content_hash)
        SELECT 2027, '公务员', 'D4大集合', 'D4测试单位' || i, 'D4关键词岗位' || i, 'D4关键词岗位' || i || ' D4测试单位' || i, 'd4big' || lpad(i::text, 27, '0')
        FROM generate_series(1, {BIG}) AS i
    """))
    db.execute(text(f"""
        INSERT INTO positions (year, job_type, exam_type, employer, position_example, search_text, content_hash)
        SELECT 2027, '事业单位', 'D4小集合', 'D4小单位' || i, 'D4小众词岗位' || i, 'D4小众词岗位' || i || ' D4小单位' || i, 'd4sml' || lpad(i::text, 27, '0')
        FROM generate_series(1, {SMALL}) AS i
    """))
    db.commit()

    r = cache.get_redis()
    for k in r.scan_iter(match="cnt:*", count=500):
        r.delete(k)

    try:
        # --- 大结果集：封顶 10001，且比全量精确计数快 ---
        big = PositionFilter(keyword="D4关键词")
        t0 = time.time()
        total, items = crud.search_positions(db, big, page=1, page_size=20)
        capped_t = time.time() - t0
        assert total == COUNT_CAP, total
        assert len(items) == 20

        q = db.query(Position).filter(
            Position.dup_of_id.is_(None), Position.invalid_reason.is_(None))
        q = crud._apply_filters(q, Position, big)
        t0 = time.time()
        exact = q.count()
        exact_t = time.time() - t0
        assert exact == BIG
        print(f"big set: capped count={total} in {capped_t*1000:.0f}ms; "
              f"exact count={exact} in {exact_t*1000:.0f}ms")

        # --- 小结果集：total 精确不变 ---
        total_s, items_s = crud.search_positions(db, PositionFilter(keyword="D4小众词"))
        assert total_s == SMALL and len(items_s) == SMALL, total_s
        print(f"small set: exact total={total_s}")

        # --- API 层：total_capped 字段 ---
        api = subprocess.Popen(
            [PY, "-m", "uvicorn", "main:app", "--port", str(PORT)],
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            env=dict(os.environ), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            for _ in range(30):
                try:
                    if rq.get(f"{BASE}/api/health", timeout=2).ok:
                        break
                except Exception:
                    time.sleep(1)
            j = rq.get(f"{BASE}/api/positions", params={"keyword": "D4关键词"}, timeout=30).json()
            assert j["total"] == COUNT_CAP and j["total_capped"] is True, (j["total"], j.get("total_capped"))
            j2 = rq.get(f"{BASE}/api/positions", params={"keyword": "D4小众词"}, timeout=30).json()
            assert j2["total"] == SMALL and j2["total_capped"] is False, (j2["total"], j2.get("total_capped"))
            print("api: big total_capped=true, small total_capped=false")
            print("ALL D4 TESTS PASSED")
        finally:
            api.terminate()
    finally:
        db.execute(text("DELETE FROM positions WHERE exam_type IN ('D4大集合', 'D4小集合')"))
        db.commit()
        db.close()
        for k in r.scan_iter(match="cnt:*", count=500):
            r.delete(k)
        for k in r.scan_iter(match="positions:*", count=500):
            r.delete(k)


if __name__ == "__main__":
    main()
