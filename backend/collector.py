"""通用公告采集器：抓取监控来源索引页，提取匹配关键词的公告链接。"""
import re
import urllib.parse
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from models import WatchSource, Announcement

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
}


def _match_keywords(title: str, keywords: str) -> bool:
    if not keywords:
        return True
    terms = [t.strip() for t in re.split(r"[,，]", keywords) if t.strip()]
    return all(t in title for t in terms)


def check_source(db: Session, source: WatchSource) -> dict:
    """抓取来源索引页，把新公告写入 announcements，返回本次结果摘要。"""
    found = 0
    try:
        resp = requests.get(source.index_url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or resp.encoding
        soup = BeautifulSoup(resp.text, "html.parser")
        for a in soup.find_all("a", href=True):
            title = a.get_text(strip=True)
            if not title or len(title) < 8:
                continue
            if not _match_keywords(title, source.keywords or ""):
                continue
            url = urllib.parse.urljoin(source.index_url, a["href"])
            if not url.startswith("http"):
                continue
            exists = db.query(Announcement.id).filter(Announcement.url == url).first()
            if exists:
                continue
            db.add(Announcement(source_id=source.id, title=title[:500], url=url))
            found += 1
        source.last_status = "ok"
        source.last_message = f"发现 {found} 条新公告" if found else "无新公告"
    except Exception as exc:  # noqa: BLE001
        source.last_status = "error"
        source.last_message = str(exc)[:500]
    source.last_checked_at = datetime.now(timezone.utc)
    db.commit()
    return {"source": source.name, "status": source.last_status, "new": found}


def check_due_sources(db: Session) -> list:
    """检查所有到期且启用的来源。"""
    now = datetime.now(timezone.utc)
    results = []
    for src in db.query(WatchSource).filter(WatchSource.enabled == 1).all():
        due = (
            src.last_checked_at is None
            or (now - src.last_checked_at).total_seconds() >= (src.interval_minutes or 60) * 60
        )
        if due:
            results.append(check_source(db, src))
    return results
