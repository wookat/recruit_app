import contextvars
import json
import logging
import os
import threading
from contextlib import contextmanager
from functools import wraps
from hashlib import md5
from typing import Any, Callable, Optional

import redis
from sqlalchemy import text as sa_text

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
_client: Optional[redis.Redis] = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(REDIS_URL, decode_responses=True)
    return _client


def _json_default(v: Any) -> Any:
    if hasattr(v, "model_dump"):
        return v.model_dump()
    if isinstance(v, set):
        return sorted(v)
    return str(v)


def _make_key(prefix: str, *args) -> str:
    payload = json.dumps(args, sort_keys=True, default=_json_default)
    return f"{prefix}:{md5(payload.encode()).hexdigest()}"


def get_or_set(key: str, ttl: int, fn: Callable[[], Any]) -> Any:
    r = get_redis()
    try:
        cached_val = r.get(key)
        if cached_val is not None:
            return json.loads(cached_val)
    except Exception:
        pass
    result = fn()
    try:
        r.setex(key, ttl, json.dumps(result, default=str))
    except Exception:
        pass
    return result


STALE_TTL = 7 * 86400


def invalidate_prefixes(*prefixes: str) -> int:
    """删除指定前缀的缓存键（stale: 副本前缀不同，天然保留），返回删除数。"""
    r = get_redis()
    n = 0
    try:
        for prefix in prefixes:
            keys = list(r.scan_iter(f"{prefix}:*"))
            if keys:
                n += r.delete(*keys)
    except Exception:
        pass
    return n


def _store(r: redis.Redis, key: str, ttl: int, stale: bool, result: Any) -> None:
    payload = json.dumps(result, default=str)
    r.setex(key, ttl, payload)
    if stale:
        r.setex(f"stale:{key}", STALE_TTL, payload)


def _is_degraded(result: Any) -> bool:
    return isinstance(result, dict) and bool(result.get("timed_out") or result.get("total_partial"))


_WARM_MODE = contextvars.ContextVar("cache_warm_mode", default=False)


@contextmanager
def warm_mode():
    """预热上下文：块内不走 SWR 短路，缺 fresh 时同步重算回填。

    进程内（非 Celery）调用预热函数时使用：否则 stale 存在会直接返回旧值，
    fresh 键始终不回填，预热形同虚设。"""
    token = _WARM_MODE.set(True)
    try:
        yield
    finally:
        _WARM_MODE.reset(token)


def _in_celery_task() -> bool:
    """Celery 任务（预热/重算路径）内不走 SWR：预热必须同步重算回填。"""
    try:
        from celery import current_task
        return current_task is not None and getattr(current_task, "request", None) is not None \
            and current_task.request.id is not None
    except Exception:  # noqa: BLE001
        return False


# 后台重算并发上限：防止大量键同时失效时线程/DB 连接雪崩（抢不到足额则
# 本次跳过重算，仍返回 stale，下次请求再试）
_REVALIDATE_SLOTS = threading.BoundedSemaphore(2)


def _revalidate_bg(func: Callable[..., Any], args, kwargs, key: str, ttl: int, lock_key: str) -> None:
    """后台重算：新开 DB 会话执行原函数并回填 fresh+stale 缓存。"""
    from database import SessionLocal  # 运行时导入避免循环依赖

    r = get_redis()
    db = SessionLocal()
    try:
        db.execute(sa_text("SET statement_timeout = '120s'"))  # 冷聚合由后台承担，放宽默认 20s
        kw = dict(kwargs)
        if "db" in kw:
            kw["db"] = db
        result = func(*args, **kw)
        if not _is_degraded(result):
            _store(r, key, ttl, True, result)
    except Exception as exc:  # noqa: BLE001
        logger.warning("cache 后台重算失败 key=%s: %s: %s", key, type(exc).__name__, exc)
    finally:
        db.close()
        _REVALIDATE_SLOTS.release()
        try:
            r.delete(lock_key)
        except Exception:
            pass


def cached(prefix: str, ttl: int = 60, stale: bool = False):
    """Redis 缓存装饰器。stale=True 时额外保留一份 7 天的副本：
    - 重算失败（如共享服务器负载导致语句超时）时返回旧数据而非 500；
    - fresh 键缺失但 stale 存在时 stale-while-revalidate：立即返回旧数据，
      后台线程（带分布式锁防雪崩）重算回填，杜绝用户面冷路径长阻塞/502。"""

    def decorator(func: Callable[..., Any]):
        @wraps(func)
        def wrapper(*args, **kwargs):
            r = get_redis()
            cache_kwargs = {k: v for k, v in kwargs.items() if k != "db"}
            key = _make_key(prefix, args, cache_kwargs)
            stale_key = f"stale:{key}"
            try:
                cached = r.get(key)
                if cached:
                    return json.loads(cached)
                if stale and not _in_celery_task() and not _WARM_MODE.get():
                    old = r.get(stale_key)
                    if old is not None:
                        lock_key = f"revalidate_lock:{key}"
                        if _REVALIDATE_SLOTS.acquire(blocking=False):
                            if r.set(lock_key, "1", nx=True, ex=600):
                                threading.Thread(
                                    target=_revalidate_bg,
                                    args=(func, args, kwargs, key, ttl, lock_key),
                                    name=f"revalidate-{prefix}",
                                    daemon=True,
                                ).start()
                            else:
                                _REVALIDATE_SLOTS.release()
                        return json.loads(old)
            except Exception:
                pass
            try:
                result = func(*args, **kwargs)
            except Exception:
                db = kwargs.get("db")
                if db is not None:
                    try:  # 回滚共享会话，避免中止事务级联到后续查询（InFailedSqlTransaction）
                        db.rollback()
                    except Exception:
                        pass
                if stale:
                    try:
                        old = r.get(stale_key)
                        if old:
                            return json.loads(old)
                    except Exception:
                        pass
                raise
            if isinstance(result, dict) and (result.get("timed_out") or result.get("total_partial")):
                return result  # 语句超时的降级空结果不入缓存，避免把「0 条」钉住 ttl 时长
            try:
                payload = json.dumps(result, default=str)
                r.setex(key, ttl, payload)
                if stale:
                    r.setex(stale_key, STALE_TTL, payload)
            except Exception:
                pass
            return result
        return wrapper
    return decorator
