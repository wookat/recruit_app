import json
import os
from functools import wraps
from hashlib import md5
from typing import Any, Callable, Optional

import redis

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


def cached(prefix: str, ttl: int = 60):
    def decorator(func: Callable[..., Any]):
        @wraps(func)
        def wrapper(*args, **kwargs):
            r = get_redis()
            cache_kwargs = {k: v for k, v in kwargs.items() if k != "db"}
            key = _make_key(prefix, args, cache_kwargs)
            try:
                cached = r.get(key)
                if cached:
                    return json.loads(cached)
            except Exception:
                pass
            result = func(*args, **kwargs)
            try:
                r.setex(key, ttl, json.dumps(result, default=str))
            except Exception:
                pass
            return result
        return wrapper
    return decorator
