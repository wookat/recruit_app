# -*- coding: utf-8 -*-
"""D5 集成自测：热门筛选 count 预热（warm_common_queries）。

需本地 postgres + redis。用法: cd backend && python tests/test_warm_caches.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cache
import crud
import precompute
from database import Base, SessionLocal, engine
from models import Position
from sqlalchemy import text


def main():
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.execute(text("DELETE FROM positions WHERE exam_type = 'D5测试'"))
    db.execute(text("""
        INSERT INTO positions (year, job_type, exam_type, employer, position_example, province, content_hash)
        SELECT 2027, '公务员', 'D5测试', 'D5单位' || i, 'D5岗位' || i, '四川', 'd5t' || lpad(i::text, 29, '0')
        FROM generate_series(1, 25) AS i
    """))
    db.commit()

    r = cache.get_redis()
    for k in r.scan_iter(match="cnt:pos:*", count=500):
        r.delete(k)

    out = precompute.warm_common_queries()
    print("warm:", out)
    assert out["errors"] == 0 and out["combos"] < 100, out
    assert out["warmed"] == out["combos"] == 1 + 31 + 2 * 3 + 2  # 无筛选+31省+年份组合+job_type

    # 省份 count key 与 crud 完全一致、TTL 提到 24h、值正确
    f_sc = crud.PositionFilter(province=["四川"])
    key = "cnt:pos:" + f_sc.model_dump_json()
    assert r.get(key) is not None, "province count not warmed"
    ttl = r.ttl(key)
    assert ttl > 23 * 3600, ttl
    assert int(r.get(key)) >= 25

    # 预热后首次请求命中缓存：不再触发 count 查询（key 值与 TTL 保持不变）
    ttl_before = r.ttl(key)
    t0 = time.time()
    total, items = crud.search_positions(db, f_sc, page=1, page_size=20)
    elapsed = time.time() - t0
    assert total == int(r.get(key))
    assert r.ttl(key) >= ttl_before - 2, "TTL 被重置说明 count 被重算（未命中缓存）"
    print(f"province filter first request: total={total} in {elapsed*1000:.0f}ms (count from cache)")

    # 无筛选与组合 key 也已预热
    for f in (crud.PositionFilter(), crud.PositionFilter(year=[2027], job_type=["公务员"])):
        k = "cnt:pos:" + f.model_dump_json()
        assert r.get(k) is not None and r.ttl(k) > 23 * 3600, k

    db.execute(text("DELETE FROM positions WHERE exam_type = 'D5测试'"))
    db.commit()
    db.close()
    print("ALL D5 TESTS PASSED")


if __name__ == "__main__":
    main()
