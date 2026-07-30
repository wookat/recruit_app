# -*- coding: utf-8 -*-
"""D2 集成自测：异步导出 + stats/filters 预计算热缓存 + 导出文件清理。

需本地 postgres + redis。端到端部分会临时拉起 uvicorn 与 celery worker 子进程。

用法: cd backend && python tests/test_export_precompute.py
"""
import json
import os
import subprocess
import sys
import time

import requests as rq

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cache
import precompute
from database import Base, SessionLocal, engine
from models import Position
from sqlalchemy import text
from tasks import EXPORTS_DIR, cleanup_exports, export_positions_task

PY = sys.executable
PORT = 8877
BASE = f"http://127.0.0.1:{PORT}"


def seed(db, n=10):
    db.query(Position).filter(Position.exam_type == "D2测试考试").delete()
    for i in range(n):
        db.add(Position(
            year=2027, job_type="公务员", exam_type="D2测试考试",
            employer=f"D2测试单位{i}", position_example=f"D2测试岗位{i}",
            edu_requirement="本科及以上", work_location="测试市",
            content_hash=f"d2test{i:026d}", content_hash_v2=f"d2v2{i:028d}",
        ))
    db.commit()


def main():
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed(db)

    # --- 1. 导出任务（eager 调用）：分块写 CSV / xlsx ---
    res = export_positions_task.apply(kwargs={
        "filters": {"exam_type": ["D2测试考试"]}, "format": "csv", "max_rows": 50000,
    }).result
    path = os.path.join(EXPORTS_DIR, res["file"])
    assert res["rows"] == 10 and os.path.isfile(path), res
    with open(path, encoding="utf-8-sig") as f:
        lines = f.read().splitlines()
    assert lines[0].startswith("ID,年份") and len(lines) == 11, lines[:2]

    res_x = export_positions_task.apply(kwargs={
        "filters": {"exam_type": ["D2测试考试"]}, "format": "xlsx", "max_rows": 50000,
    }).result
    assert res_x["rows"] == 10 and os.path.isfile(os.path.join(EXPORTS_DIR, res_x["file"]))

    # --- 2. 清理任务：>24h 文件被删除，新文件保留 ---
    old_path = os.path.join(EXPORTS_DIR, "positions_old_test.csv")
    with open(old_path, "w") as f:
        f.write("x")
    os.utime(old_path, (time.time() - 25 * 3600, time.time() - 25 * 3600))
    out = cleanup_exports.apply().result
    assert not os.path.exists(old_path), "old file not removed"
    assert os.path.isfile(path), "fresh file should be kept"
    print("cleanup:", out)

    # --- 3. 预计算热缓存：写入 stats/filters key，TTL≈24h ---
    r = cache.get_redis()
    r.delete(precompute.STATS_KEY, precompute.FILTERS_KEY)
    summary = precompute.refresh_hot_caches()
    print("precompute:", summary)
    assert r.ttl(precompute.STATS_KEY) > 23 * 3600
    assert r.ttl(precompute.FILTERS_KEY) > 23 * 3600
    stats_cached = json.loads(r.get(precompute.STATS_KEY))
    assert stats_cached["total"] >= 10 and "by_year" in stats_cached
    filters_cached = json.loads(r.get(precompute.FILTERS_KEY))
    assert "years" in filters_cached and "location_tree" in filters_cached

    # --- 4. 端到端：uvicorn + celery worker，POST → status → download ---
    env = dict(os.environ)
    api = subprocess.Popen(
        [PY, "-m", "uvicorn", "main:app", "--port", str(PORT)],
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    worker = subprocess.Popen(
        [PY, "-m", "celery", "-A", "celery_app", "worker", "-c", "1", "-l", "warning"],
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(30):
            try:
                if rq.get(f"{BASE}/api/health", timeout=2).ok:
                    break
            except Exception:
                time.sleep(1)
        # 命中预计算缓存的 /api/stats 应当很快
        t0 = time.time()
        s = rq.get(f"{BASE}/api/stats", timeout=10)
        assert s.ok and s.json()["total"] >= 10
        print(f"/api/stats (hot cache): {time.time()-t0:.3f}s")

        resp = rq.post(f"{BASE}/api/export", json={
            "exam_type": ["D2测试考试"], "format": "csv", "max_rows": 50000,
        }, timeout=10)
        assert resp.ok, resp.text
        task_id = resp.json()["task_id"]
        status = None
        for _ in range(60):
            status = rq.get(f"{BASE}/api/export/status/{task_id}", timeout=10).json()
            if status["status"] in ("SUCCESS", "FAILURE"):
                break
            time.sleep(1)
        assert status and status["status"] == "SUCCESS" and status["rows"] == 10, status
        dl = rq.get(f"{BASE}/api/export/download/{task_id}", timeout=30)
        assert dl.ok and "D2测试岗位" in dl.content.decode("utf-8-sig"), dl.status_code
        assert len(dl.content.decode("utf-8-sig").splitlines()) == 11

        # 同步快路径仍可用且上限 2000
        sync = rq.get(f"{BASE}/api/export", params={"exam_type": ["D2测试考试"]}, timeout=30)
        assert sync.ok and "D2测试岗位" in sync.content.decode("utf-8-sig")

        # 未完成/不存在任务的下载 → 404
        assert rq.get(f"{BASE}/api/export/download/nonexistent-task", timeout=10).status_code == 404
        print("ALL D2 TESTS PASSED")
    finally:
        api.terminate()
        worker.terminate()
        db.query(Position).filter(Position.exam_type == "D2测试考试").delete()
        db.commit()
        db.close()
        for fn in (res["file"], res_x["file"]):
            p = os.path.join(EXPORTS_DIR, fn)
            if os.path.exists(p):
                os.remove(p)


if __name__ == "__main__":
    main()
