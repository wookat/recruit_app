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
