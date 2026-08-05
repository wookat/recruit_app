"""NCSS (job.ncss.cn) 详情页字段补全：industry（campus_jobs，source_table='NCSS'）。

数据源（合法公开 HTML 详情页，无需登录/Cookie/验证码）：
    GET https://job.ncss.cn/student/jobs/{jobId}/detail.html
    行业取自 id="mainindustries"（公司所属行业）；id="industrySectors"（涉及领域）
    常为 "--"，仅作兜底。

已核实的不可得字段（2026-08 实测，如实止损）：
    - deadline_date：详情页不展示任何截止/有效期信息，列表接口亦无该字段，不猜测；
    - apply_url：投递走 /student/applyjobs/issetwebsite 接口，未登录返回 302，
      页面 HTML 无公开投递外链，不绕过登录，留空。

零覆盖原则：目标字段（industry）已非空则跳过，不覆盖既有值。

审计：每条写 JSONL（id、url、原始值、解析值、动作 filled/skipped/error）。

用法：
    python enrich_ncss.py --dry-run --limit 500        # 试点：只抓取解析，不写库
    python enrich_ncss.py --limit 500                  # 试点 apply：写库 + 缓存失效
    python enrich_ncss.py                              # 全量 apply
"""
import argparse
import json
import time
from datetime import datetime

import requests
from bs4 import BeautifulSoup
from sqlalchemy import text

import cache
from database import SessionLocal
from models import CampusJob

HEADERS = {
    "Accept": "text/html,application/xhtml+xml",
    "Referer": "https://job.ncss.cn/student/jobs/index.html",
    "User-Agent": "Mozilla/5.0 (compatible; shangan-leida-collector; +https://jobs.zalize.com)",
}

SOURCE_TABLE = "NCSS"
REQUEST_INTERVAL = 1.0  # 限速：每请求间隔 ≥1s
TIMEOUT = 30
INDUSTRY_LIMIT = 200

_last_request_at = 0.0


def _throttle():
    global _last_request_at
    wait = REQUEST_INTERVAL - (time.time() - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    _last_request_at = time.time()


def fetch_detail(url: str, retries: int = 2) -> tuple:
    """返回 (html, error)。404/410 视为职位已下架。"""
    for attempt in range(retries + 1):
        try:
            _throttle()
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            if r.status_code in (404, 410):
                return "", f"gone http={r.status_code}"
            r.raise_for_status()
            return r.text, ""
        except Exception as exc:  # noqa: BLE001
            if attempt < retries:
                time.sleep(2.0 * (attempt + 1))
                continue
            return "", str(exc)
    return "", "unreachable"


def parse_industry(html: str) -> tuple:
    """返回 (industry, raw)。'--'/空视为无值。"""
    soup = BeautifulSoup(html, "html.parser")
    for eid in ("mainindustries", "industrySectors"):
        el = soup.find(id=eid)
        raw = el.get_text(strip=True) if el else ""
        if raw and raw != "--":
            return raw, f"{eid}={raw}"
    return "", ""


def enrich(dry_run: bool = False, limit: int = 0, audit_path: str = "",
           days: int = 0) -> dict:
    db = SessionLocal()
    audit_path = audit_path or (
        f"enrich_ncss_audit_{datetime.now():%Y%m%d_%H%M%S}.jsonl")
    stats = {"dry_run": dry_run, "scanned": 0, "filled": 0, "skipped": 0,
             "error": 0}
    try:
        rows = db.execute(text(
            "SELECT id, announce_url, industry FROM campus_jobs "
            "WHERE source_table = :st AND (industry IS NULL OR industry = '') "
            "AND announce_url LIKE 'https://job.ncss.cn/%'"
            + (" AND created_at >= now() - make_interval(days => :days)" if days else "")
            + " ORDER BY id"
            + (" LIMIT :lim" if limit else "")),
            {"st": SOURCE_TABLE,
             **({"lim": limit} if limit else {}),
             **({"days": days} if days else {})}).fetchall()
        print(f"待补全 {len(rows)} 条（industry 为空）", flush=True)
        with open(audit_path, "a", encoding="utf-8") as audit:
            for i, row in enumerate(rows, 1):
                stats["scanned"] += 1
                rec = {"id": row.id, "url": row.announce_url,
                       "fetched_at": datetime.now().isoformat(timespec="seconds")}
                html, err = fetch_detail(row.announce_url)
                if err:
                    rec.update(action="error", error=err)
                    stats["error"] += 1
                else:
                    industry, raw = parse_industry(html)
                    rec.update(raw=raw, parsed={"industry": industry})
                    if not industry:
                        rec["action"] = "skipped"
                        rec["reason"] = "no industry on page"
                        stats["skipped"] += 1
                    else:
                        rec["action"] = "filled"
                        stats["filled"] += 1
                        if not dry_run:
                            obj = db.get(CampusJob, row.id)
                            if obj is not None and not (obj.industry or "").strip():
                                obj.industry = industry[:INDUSTRY_LIMIT]
                audit.write(json.dumps(rec, ensure_ascii=False) + "\n")
                if not dry_run and i % 200 == 0:
                    db.commit()
                if i % 50 == 0:
                    print(f"  进度 {i}/{len(rows)} {stats}", flush=True)
        if not dry_run:
            db.commit()
            cache.invalidate_prefixes(
                "campus_filters", "campus_counts", "campus_timeline")
        stats["audit"] = audit_path
        print(json.dumps(stats, ensure_ascii=False, indent=2))
        return stats
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="NCSS 详情页补全 campus_jobs.industry")
    parser.add_argument("--dry-run", action="store_true", help="只抓取解析不写库")
    parser.add_argument("--limit", type=int, default=0, help="最多处理 N 条")
    parser.add_argument("--audit", default="", help="JSONL 审计文件路径")
    parser.add_argument("--days", type=int, default=0, help="只处理最近 N 天入库的行")
    args = parser.parse_args()
    enrich(dry_run=args.dry_run, limit=args.limit, audit_path=args.audit, days=args.days)


if __name__ == "__main__":
    main()
