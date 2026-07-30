"""热缓存预计算：主动刷新 /api/stats 与 /api/filters 的 Redis 缓存（长 TTL），
让用户请求永远命中热缓存，消除冷查询开销。

调用点：Celery beat 每日采集后 + pipeline.post_ingest 入库后。
"""
import json

import cache
import crud
from database import SessionLocal

HOT_TTL = 24 * 3600

# 与 @cache.cached 装饰器一致的 key（endpoint 无位置参数、无非 db 关键字参数）
STATS_KEY = cache._make_key("stats", (), {})
FILTERS_KEY = cache._make_key("filters", (), {})


def refresh_hot_caches() -> dict:
    """重算 stats 与 filters 并以 24h TTL 写入 Redis，返回结果摘要。"""
    db = SessionLocal()
    try:
        stats = crud.get_stats(db)
        filters = crud.get_filter_options(db)
    finally:
        db.close()
    r = cache.get_redis()
    r.setex(STATS_KEY, HOT_TTL, json.dumps(stats, default=str))
    r.setex(FILTERS_KEY, HOT_TTL, json.dumps(filters, default=str))
    return {"stats_total": stats.get("total"), "filters_keys": list(filters.keys())}


# 组合预热用的热门年份与工作类型
WARM_YEARS = (2027, 2026)
WARM_JOB_TYPES = ("公务员", "事业单位")


def _warm_count(db, r, filters: "crud.PositionFilter") -> None:
    """重算一个筛选组合的 count 缓存（key 与 crud 完全一致），并把 TTL 提到 24h。"""
    key = "cnt:pos:" + filters.model_dump_json()
    r.delete(key)  # 先删再由 search_positions 内的 get_or_set 重算写入
    crud.search_positions(db, filters, page=1, page_size=20)
    r.expire(key, HOT_TTL)


def warm_common_queries() -> dict:
    """预热最常用筛选组合的 count 缓存：无筛选、31 省单省、热门年份×工作类型。

    逐个执行（避免内存峰值），总查询数 <100；count 走 capped count（LIMIT 10001）。
    """
    combos = [crud.PositionFilter()]  # (a) 无筛选默认列表 page1
    combos += [crud.PositionFilter(province=[p]) for p in crud.ALL_PROVINCES]  # (b) 31 省
    for y in WARM_YEARS:  # (c) 热门年份 × 工作类型
        combos.append(crud.PositionFilter(year=[y]))
        for jt in WARM_JOB_TYPES:
            combos.append(crud.PositionFilter(year=[y], job_type=[jt]))
    for jt in WARM_JOB_TYPES:
        combos.append(crud.PositionFilter(job_type=[jt]))

    r = cache.get_redis()
    warmed, errors = 0, 0
    db = SessionLocal()
    try:
        for f in combos:
            try:
                _warm_count(db, r, f)
                warmed += 1
            except Exception:  # noqa: BLE001  单个组合失败不影响其余预热
                errors += 1
                db.rollback()
    finally:
        db.close()
    return {"warmed": warmed, "errors": errors, "combos": len(combos)}
