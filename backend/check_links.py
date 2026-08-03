"""校招/编制链接死链扫描：检测未截止岗位的投递/报名/公告链接是否仍可访问。

只判定「硬失效」（DNS/连接失败、4xx/5xx）；上游 302 到别站错误页等
软失效不误判。结果写入 link_checks 表，供质量卡展示。
可 CLI 单独运行：python check_links.py [limit]
"""
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine
from models import LinkCheck

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
TIMEOUT = 8
WORKERS = int(os.getenv("LINK_CHECK_WORKERS", "8"))


def _probe(url: str) -> tuple[int, "int | None", str]:
    """返回 (ok, status_code, error)。HEAD 被拒（405 等）时回退 GET。"""
    try:
        r = requests.head(url, timeout=TIMEOUT, allow_redirects=True, headers={"User-Agent": UA})
        if r.status_code in (403, 405, 501) or r.status_code >= 500:
            r = requests.get(url, timeout=TIMEOUT, allow_redirects=True, stream=True,
                             headers={"User-Agent": UA})
            r.close()
        return (1 if r.status_code < 400 else 0), r.status_code, ""
    except Exception as exc:  # noqa: BLE001  畸形 URL（如含中文 userinfo）同样视为失效
        return 0, None, type(exc).__name__[:200]


def run_check(db: Session, limit: "int | None" = None) -> dict:
    """扫描未截止岗位的去重链接（校招 apply_url + 编制 apply_url/announce_url），upsert link_checks。"""
    Base.metadata.create_all(bind=engine, tables=[LinkCheck.__table__])
    rows = db.execute(text(
        "SELECT DISTINCT apply_url AS u FROM campus_jobs"
        " WHERE apply_url ~ '^https?://'"
        " AND (deadline_date IS NULL OR deadline_date >= CURRENT_DATE)"
        " UNION"
        " SELECT DISTINCT apply_url FROM bianzhi_jobs"
        " WHERE apply_url ~ '^https?://'"
        " AND (deadline_date IS NULL OR deadline_date >= CURRENT_DATE)"
        " UNION"
        " SELECT DISTINCT announce_url FROM bianzhi_jobs"
        " WHERE announce_url ~ '^https?://'"
        " AND (deadline_date IS NULL OR deadline_date >= CURRENT_DATE)"
        " ORDER BY u"
    )).fetchall()
    urls = [r[0] for r in rows]
    if limit:
        urls = urls[:limit]
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        results = list(ex.map(_probe, urls))
    dead = 0
    for url, (ok, code, err) in zip(urls, results):
        dead += 1 - ok
        db.execute(text(
            "INSERT INTO link_checks (url, ok, status_code, error, checked_at)"
            " VALUES (:u, :o, :c, :e, now())"
            " ON CONFLICT (url) DO UPDATE SET ok=:o, status_code=:c, error=:e, checked_at=now()"
        ), {"u": url, "o": ok, "c": code, "e": err})
    db.commit()
    return {"checked": len(urls), "dead": dead}


def main() -> None:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    db = SessionLocal()
    try:
        print(run_check(db, limit))
    finally:
        db.close()


if __name__ == "__main__":
    main()
