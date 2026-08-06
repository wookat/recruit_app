"""Web Push 订阅管理：VAPID 公钥下发、订阅登记/注销。

收藏数据只存在浏览器本地，订阅时随请求上报「收藏截止日快照」
（标题 + 日期），每日定时任务据此推送临近截止提醒。
"""
import json
import os
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

import models
from database import get_db

router = APIRouter(prefix="/api/push", tags=["push"])

MAX_ITEMS = 300
MAX_FILTERS = 30
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FILTER_URL_PREFIXES = ("/api/positions?", "/api/campus?", "/api/bianzhi?")
REMIND_NODE_CHOICES = (1, 3, 7)


def clean_nodes(nodes) -> List[int]:
    """提醒节点白名单过滤 + 去重升序。"""
    if not isinstance(nodes, list):
        return []
    return sorted({n for n in nodes if isinstance(n, int) and n in REMIND_NODE_CHOICES})


class PushItem(BaseModel):
    t: str = Field(..., max_length=120)
    d: str = Field(..., max_length=10)
    n: Optional[List[int]] = Field(None, max_length=8)  # 单岗位提醒节点（截止前天数）


class PushFilter(BaseModel):
    n: str = Field(..., max_length=60)
    u: str = Field(..., max_length=1000)


class SubscribeBody(BaseModel):
    endpoint: str = Field(..., max_length=2000)
    p256dh: str = Field(..., max_length=200)
    auth: str = Field(..., max_length=100)
    remind_days: int = Field(3, ge=1, le=30)  # 兼容旧客户端：默认节点最大值
    remind_nodes: List[int] = Field(default_factory=list, max_length=8)
    items: List[PushItem] = Field(default_factory=list)
    filters: List[PushFilter] = Field(default_factory=list)


class UnsubscribeBody(BaseModel):
    endpoint: str = Field(..., max_length=2000)


@router.get("/vapid-key")
def vapid_key():
    key = os.getenv("VAPID_PUBLIC_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="push not configured")
    return {"key": key}


@router.post("/subscribe")
def subscribe(body: SubscribeBody, db: Session = Depends(get_db)):
    if not body.endpoint.startswith("https://"):
        raise HTTPException(status_code=422, detail="invalid endpoint")
    items = []
    for it in body.items[:MAX_ITEMS]:
        if not (it.t.strip() and DATE_RE.match(it.d)):
            continue
        item = {"t": it.t.strip()[:120], "d": it.d}
        nodes = clean_nodes(it.n)
        if nodes:
            item["n"] = nodes
        items.append(item)
    default_nodes = clean_nodes(body.remind_nodes) or (
        [body.remind_days] if body.remind_days in REMIND_NODE_CHOICES else [3]
    )
    # 保存筛选快照：同 u 保留已有基线，新增的基线由每日任务首次初始化（null）
    existing = (
        db.query(models.PushSubscription.filters_json)
        .filter(models.PushSubscription.endpoint == body.endpoint)
        .scalar()
    )
    try:
        old = {f.get("u"): f.get("t") for f in json.loads(existing or "[]")}
    except ValueError:
        old = {}
    filters = [
        {"n": f.n.strip()[:60], "u": f.u, "t": old.get(f.u)}
        for f in body.filters[:MAX_FILTERS]
        if f.n.strip() and f.u.startswith(FILTER_URL_PREFIXES)
    ]
    values = {
        "p256dh": body.p256dh,
        "auth": body.auth,
        "remind_days": body.remind_days,
        "remind_nodes": json.dumps(default_nodes),
        "items_json": json.dumps(items, ensure_ascii=False),
        "filters_json": json.dumps(filters, ensure_ascii=False),
        "failures": 0,
    }
    # 单语句 upsert：并发同 endpoint 订阅（页面双重同步）不会因先查后插竞态冲突
    stmt = pg_insert(models.PushSubscription).values(endpoint=body.endpoint, **values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[models.PushSubscription.endpoint],
        set_={**values, "updated_at": func.now()},
    )
    db.execute(stmt)
    db.commit()
    return {"ok": True, "items": len(items), "filters": len(filters)}


@router.post("/unsubscribe")
def unsubscribe(body: UnsubscribeBody, db: Session = Depends(get_db)):
    deleted = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.endpoint == body.endpoint)
        .delete()
    )
    db.commit()
    return {"ok": True, "deleted": deleted}
