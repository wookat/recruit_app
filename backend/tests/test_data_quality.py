# -*- coding: utf-8 -*-
"""D3 集成自测：signup_deadline 解析增强 + 分批回填 + 数据质量审计报告 + admin API + seed 幂等。

需本地 postgres + redis。用法: cd backend && python tests/test_data_quality.py
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime

import requests as rq

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cache
from database import Base, SessionLocal, engine
from etl.normalize_v2 import parse_signup_deadline_v2
from models import Position, WatchSource
from sqlalchemy import text
from tasks import DQ_REPORT_KEY, data_quality_audit

PY = sys.executable
PORT = 8878
BASE = f"http://127.0.0.1:{PORT}"
TOKEN = "d3-test-token"


def test_parser():
    cases = [
        ("2026年10月15日-10月24日", None, datetime(2026, 10, 24, 23, 59)),
        ("2026年10月15日至24日", None, datetime(2026, 10, 24, 23, 59)),
        ("10月15日8:00至10月24日18:00", 2026, datetime(2026, 10, 24, 18, 0)),
        ("截止2026-10-24", None, datetime(2026, 10, 24, 23, 59)),
        ("报名截止时间：2026年10月24日18:00", None, datetime(2026, 10, 24, 18, 0)),
        ("2026-10-15至2026-10-24", None, datetime(2026, 10, 24, 23, 59)),
        ("2024-10-15 8:00 至 2024-10-24 18:00", None, datetime(2024, 10, 24, 18, 0)),
        ("10.15-10.24", 2026, datetime(2026, 10, 24, 23, 59)),
        ("详见公告", 2026, None),
        ("", None, None),
    ]
    for s, y, expect in cases:
        got = parse_signup_deadline_v2(s, default_year=y)
        assert got == expect, (s, got, expect)
    print(f"parser: {len(cases)} cases passed")


def seed_rows(db):
    db.query(Position).filter(Position.exam_type == "D3测试考试").delete()
    samples = [
        ("2026年10月15日-10月24日", True),
        ("10月15日8:00至10月24日18:00", True),   # 年份靠 year 兜底
        ("截止2026-10-24", True),
        ("详见公告", False),
        (None, False),
    ]
    for i, (st, _) in enumerate(samples):
        db.add(Position(
            year=2026, job_type="公务员", exam_type="D3测试考试",
            employer=f"D3测试单位{i}", position_example=f"D3测试岗位{i}",
            signup_time=st, signup_deadline=None,
            work_location="测试市" if i % 2 == 0 else None,
            content_hash=f"d3test{i:026d}", content_hash_v2=f"d3v2{i:028d}",
        ))
    db.commit()
    return sum(1 for _, ok in samples if ok)


def main():
    test_parser()
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    expect_filled = seed_rows(db)

    # --- 审计任务（eager）：回填 + 报告写入 Redis ---
    cache.get_redis().delete(DQ_REPORT_KEY)
    out = data_quality_audit.apply().result
    print("audit:", out)
    filled = db.query(Position).filter(
        Position.exam_type == "D3测试考试", Position.signup_deadline.isnot(None)
    ).count()
    assert filled == expect_filled, (filled, expect_filled)
    row = db.query(Position).filter(
        Position.exam_type == "D3测试考试", Position.signup_time == "10月15日8:00至10月24日18:00"
    ).one()
    assert row.signup_deadline.strftime("%Y-%m-%d %H:%M") == "2026-10-24 18:00"

    raw = cache.get_redis().get(DQ_REPORT_KEY)
    assert raw and cache.get_redis().ttl(DQ_REPORT_KEY) > 47 * 3600
    report = json.loads(raw)
    for key in ("rows", "by_year", "by_job_type", "missing_fields", "signup_deadline"):
        assert key in report, key
    assert report["rows"]["total"] >= 5
    assert report["rows"]["added_last_7d"] >= 5
    assert report["missing_fields"]["work_location"] >= 2
    assert report["signup_deadline"]["parse_rate"] is not None
    print("report keys ok; parse_rate:", report["signup_deadline"]["parse_rate"])

    # --- seed 幂等 + 省份覆盖 ---
    from watch_2027_announcements import PROVINCE_SITES, WATCHES
    assert len(PROVINCE_SITES) == 31, len(PROVINCE_SITES)
    prov_watches = [w for w in WATCHES if w["name"].startswith("shengkao_")]
    assert all(w.get("interval_minutes") == 1440 for w in prov_watches)

    # --- admin API（uvicorn 子进程）---
    env = dict(os.environ, ADMIN_TOKEN=TOKEN)
    api = subprocess.Popen(
        [PY, "-m", "uvicorn", "main:app", "--port", str(PORT)],
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
        h = {"X-Admin-Token": TOKEN}
        resp = rq.get(f"{BASE}/api/admin/data-quality", headers=h, timeout=10)
        assert resp.ok and resp.json()["rows"]["total"] >= 5, resp.text
        assert rq.get(f"{BASE}/api/admin/data-quality", timeout=10).status_code == 401

        # seed 两次结果一致（幂等）
        n_before = db.query(WatchSource).count()
        r1 = rq.post(f"{BASE}/api/admin/watch-sources/seed", headers=h, timeout=30).json()
        r2 = rq.post(f"{BASE}/api/admin/watch-sources/seed", headers=h, timeout=30).json()
        assert r2["added"] == 0, r2
        n_after = db.query(WatchSource).count()
        assert n_after == n_before + r1["added"]
        prov_cnt = db.query(WatchSource).filter(WatchSource.name.like("shengkao_2027_%")).count()
        assert prov_cnt == 31, prov_cnt
        assert db.query(WatchSource).filter(
            WatchSource.name.like("shengkao_2027_%"), WatchSource.interval_minutes == 1440
        ).count() >= 22  # 新增省份 interval=1440
        print(f"seed: added={r1['added']} idempotent ok; province sources={prov_cnt}")
        print("ALL D3 TESTS PASSED")
    finally:
        api.terminate()
        db.query(Position).filter(Position.exam_type == "D3测试考试").delete()
        db.commit()
        db.close()


if __name__ == "__main__":
    main()
