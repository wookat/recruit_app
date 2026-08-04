"""Web Push 订阅管理：VAPID 公钥下发、订阅登记/注销。

收藏数据只存在浏览器本地，订阅时随请求上报「收藏截止日快照」
（标题 + 日期），每日定时任务据此推送临近截止提醒。
"""
import json
import os
import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import models
from database import get_db

router = APIRouter(prefix="/api/push", tags=["push"])

MAX_ITEMS = 300
MAX_FILTERS = 30
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FILTER_URL_PREFIXES = ("/api/positions?", "/api/campus?", "/api/bianzhi?")


class PushItem(BaseModel):
    t: str = Field(..., max_length=120)
    d: str = Field(..., max_length=10)


class PushFilter(BaseModel):
    n: str = Field(..., max_length=60)
    u: str = Field(..., max_length=1000)


class SubscribeBody(BaseModel):
    endpoint: str = Field(..., max_length=2000)
    p256dh: str = Field(..., max_length=200)
    auth: str = Field(..., max_length=100)
    remind_days: int = Field(3, ge=1, le=30)
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
    items = [
        {"t": it.t.strip()[:120], "d": it.d}
        for it in body.items[:MAX_ITEMS]
        if it.t.strip() and DATE_RE.match(it.d)
    ]
    row = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.endpoint == body.endpoint)
        .one_or_none()
    )
    if row is None:
        row = models.PushSubscription(endpoint=body.endpoint)
        db.add(row)
    row.p256dh = body.p256dh
    row.auth = body.auth
    row.remind_days = body.remind_days
    row.items_json = json.dumps(items, ensure_ascii=False)
    # 保存筛选快照：同 u 保留已有基线，新增的基线由每日任务首次初始化（null）
    try:
        old = {f.get("u"): f.get("t") for f in json.loads(row.filters_json or "[]")}
    except ValueError:
        old = {}
    filters = [
        {"n": f.n.strip()[:60], "u": f.u, "t": old.get(f.u)}
        for f in body.filters[:MAX_FILTERS]
        if f.n.strip() and f.u.startswith(FILTER_URL_PREFIXES)
    ]
    row.filters_json = json.dumps(filters, ensure_ascii=False)
    row.failures = 0
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
