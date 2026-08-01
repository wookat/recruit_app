"""R6 自测：health-summary 接口与失败告警记录（本地 postgres+redis）。

运行：cd backend && ../../../venv-recruit/bin/python tests/test_health_summary.py
"""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("ADMIN_TOKEN", "test-token-r6")

import subprocess  # noqa: E402

import requests  # noqa: E402


def main():
    from database import SessionLocal, engine
    from models import Base, CrawlRun, WatchSource
    from cache import get_redis
    import precompute

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    r = get_redis()

    # 造数据：一个来源 + 24h 内成功/失败运行 + 告警汇总行
    src = db.query(WatchSource).filter(WatchSource.name == "R6测试来源").first()
    if not src:
        src = WatchSource(name="R6测试来源", index_url="http://example.com/r6", enabled=1, interval_minutes=1440)
        db.add(src)
        db.commit()
    now = datetime.now(timezone.utc)
    db.query(CrawlRun).filter(CrawlRun.error.like("%R6%")).delete(synchronize_session=False)
    db.add(CrawlRun(source_id=src.id, status="error", started_at=now - timedelta(hours=2),
                    finished_at=now - timedelta(hours=2) + timedelta(seconds=3), error="R6 boom"))
    db.commit()
    db.add(CrawlRun(source_id=src.id, status="success", started_at=now - timedelta(hours=1),
                    finished_at=now - timedelta(hours=1) + timedelta(seconds=12), rows_ingested=5, error="R6-ok"))
    db.add(CrawlRun(source_id=None, status="alert", finished_at=now,
                    error=json.dumps(["R6测试来源"], ensure_ascii=False)))
    db.commit()

    # 热缓存
    r.setex(precompute.STATS_KEY, 3600, "{}")
    r.setex(precompute.FILTERS_KEY, 3600, "{}")

    server = subprocess.Popen(
        ["/home/ubuntu/venv-recruit/bin/uvicorn", "main:app", "--port", "8765"],
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        env={**os.environ, "ADMIN_TOKEN": "test-token-r6"},
    )
    base = "http://127.0.0.1:8765"
    for _ in range(50):
        try:
            requests.get(base + "/docs", timeout=1)
            break
        except Exception:
            time.sleep(0.3)

    # 鉴权
    assert requests.get(base + "/api/admin/health-summary").status_code == 401

    t0 = time.time()
    res = requests.get(base + "/api/admin/health-summary", headers={"X-Admin-Token": "test-token-r6"})
    elapsed = time.time() - t0
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["crawl_24h"]["success"] >= 1
    assert data["crawl_24h"]["failed"] >= 1
    latest = {x["source_name"]: x for x in data["crawl_24h"]["latest_by_source"]}
    lr = latest["R6测试来源"]
    assert lr["status"] == "success" and lr["duration_seconds"] == 12.0 and lr["rows_ingested"] == 5
    assert "R6测试来源" in data["failed_sources_yesterday"]["sources"]
    assert data["cache_ttl_seconds"]["stats"] > 0 and data["cache_ttl_seconds"]["filters"] > 0
    assert "positions" in data["table_estimates"]
    assert elapsed < 1.0, f"health-summary too slow: {elapsed:.2f}s"

    # check_watch_sources 告警落地（无到期来源时不写告警）
    import tasks
    before = db.query(CrawlRun).filter(CrawlRun.status == "alert").count()
    db.query(WatchSource).update({WatchSource.last_checked_at: now})  # 全部不到期，跳过真实抓取
    db.commit()
    out = tasks.check_watch_sources.apply().result
    assert "failed_sources" in out
    db.expire_all()
    after = db.query(CrawlRun).filter(CrawlRun.status == "alert").count()
    assert after == before  # 无失败不新增告警

    print(f"health-summary 200 in {elapsed*1000:.0f}ms; success={data['crawl_24h']['success']} "
          f"failed={data['crawl_24h']['failed']} failed_yesterday={data['failed_sources_yesterday']['sources']}")
    print(f"cache_ttl={data['cache_ttl_seconds']} tables={data['table_estimates']}")
    print("ALL R6 TESTS PASSED")
    server.terminate()
    db.close()


if __name__ == "__main__":
    main()
