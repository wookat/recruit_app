"""中智招聘 (ciiczhaopin.com) 详情字段补全：deadline_date/deadline_text 与 industry
（campus_jobs，source_table='中智'）。

数据源（合法公开 JSON 接口，无需登录/Cookie/验证码，同 collect_ciic.py）：
    GET  https://www.ciiczhaopin.com/api/position/detail?uuid={uuid}
         result.position.deadlineTime（"YYYY-MM-DD HH:MM:SS"）→ deadline
    POST https://www.ciiczhaopin.com/api/position/search  body {"id": uuid, ...}
         result.result[0].industry → industry（detail 接口不含行业字段）

零覆盖原则：目标字段已非空则跳过；日期解析不出严格 YYYY-MM-DD 时跳过并记录，不猜。

审计：每条写 JSONL（id、url、原始值、解析值、动作 filled/skipped/error）。

用法：
    python enrich_ciic.py --dry-run --limit 500        # 试点：只抓取解析，不写库
    python enrich_ciic.py --limit 500                  # 试点 apply：写库 + 缓存失效
    python enrich_ciic.py                              # 全量 apply
"""
import argparse
import json
import re
import time
from datetime import datetime

import requests
from sqlalchemy import text

import cache
from database import SessionLocal
from models import CampusJob

API_DETAIL = "https://www.ciiczhaopin.com/api/position/detail"
API_SEARCH = "https://www.ciiczhaopin.com/api/position/search"

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Group-Name": "zhaowen",
    "User-Agent": "Mozilla/5.0 (compatible; shangan-leida-collector; +https://jobs.zalize.com)",
}

SOURCE_TABLE = "中智"
REQUEST_INTERVAL = 1.0  # 限速：每请求间隔 ≥1s
TIMEOUT = 30
INDUSTRY_LIMIT = 200
DEADLINE_TEXT_LIMIT = 200

_UUID_RE = re.compile(r"uuid=([0-9a-f]{32})")
_DATE_RE = re.compile(r"^(20\d{2})-(\d{2})-(\d{2})")

_last_request_at = 0.0


def _throttle():
    global _last_request_at
    wait = REQUEST_INTERVAL - (time.time() - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    _last_request_at = time.time()


def _request(method: str, url: str, retries: int = 2, **kw):
    for attempt in range(retries + 1):
        try:
            _throttle()
            r = requests.request(method, url, headers=HEADERS, timeout=TIMEOUT, **kw)
            r.raise_for_status()
            return r.json(), ""
        except Exception as exc:  # noqa: BLE001
            if attempt < retries:
                time.sleep(2.0 * (attempt + 1))
                continue
            return None, str(exc)
    return None, "unreachable"


def fetch_detail(uuid: str) -> tuple:
    """detail 接口：返回 (position dict|None, error)。职位下架时返回空 position。"""
    res, err = _request("GET", API_DETAIL, params={"uuid": uuid})
    if err:
        return None, err
    pos = ((res or {}).get("result") or {}).get("position") or {}
    if not pos:
        return None, f"gone code={res.get('code')} msg={res.get('message')}"
    return pos, ""


def fetch_industry(uuid: str) -> tuple:
    """search 接口按 id 精确查：返回 (industry, error)。"""
    payload = {"page": 1, "size": 5, "keyword": "", "workplace": "", "industry": "",
               "jobcate": "", "qualitative": "", "education": "", "salary": "",
               "scale": "", "workexp": "", "attr": "", "disability": "",
               "nature": "", "toppingcity": "", "id": uuid, "orgid": "",
               "orgcity_or": None, "workplace_or": None}
    res, err = _request("POST", API_SEARCH, json=payload)
    if err:
        return "", err
    items = ((res or {}).get("result") or {}).get("result") or []
    for it in items:
        if it.get("id") == uuid:
            return (it.get("industry") or it.get("industry_show") or "").strip(), ""
    return "", ""


def parse_deadline(raw: str):
    """严格解析 'YYYY-MM-DD ...' 前缀；不匹配返回 None（不猜）。"""
    m = _DATE_RE.match((raw or "").strip())
    if not m:
        return None
    try:
        return datetime.strptime(m.group(0), "%Y-%m-%d").date()
    except ValueError:
        return None


def enrich(dry_run: bool = False, limit: int = 0, audit_path: str = "") -> dict:
    db = SessionLocal()
    audit_path = audit_path or (
        f"enrich_ciic_audit_{datetime.now():%Y%m%d_%H%M%S}.jsonl")
    stats = {"dry_run": dry_run, "scanned": 0, "deadline_filled": 0,
             "industry_filled": 0, "skipped": 0, "error": 0}
    try:
        rows = db.execute(text(
            "SELECT id, announce_url, deadline_date, industry FROM campus_jobs "
            "WHERE source_table = :st AND (deadline_date IS NULL "
            "OR industry IS NULL OR industry = '') "
            "AND announce_url LIKE 'https://www.ciiczhaopin.com/%' ORDER BY id"
            + (" LIMIT :lim" if limit else "")),
            {"st": SOURCE_TABLE, **({"lim": limit} if limit else {})}).fetchall()
        print(f"待补全 {len(rows)} 条（deadline_date 或 industry 为空）", flush=True)
        with open(audit_path, "a", encoding="utf-8") as audit:
            for i, row in enumerate(rows, 1):
                stats["scanned"] += 1
                rec = {"id": row.id, "url": row.announce_url,
                       "fetched_at": datetime.now().isoformat(timespec="seconds")}
                m = _UUID_RE.search(row.announce_url or "")
                if not m:
                    rec.update(action="error", error="no uuid in announce_url")
                    stats["error"] += 1
                    audit.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    continue
                uuid = m.group(1)
                raw, parsed, errors = {}, {}, []

                need_deadline = row.deadline_date is None
                if need_deadline:
                    pos, err = fetch_detail(uuid)
                    if err:
                        errors.append(f"detail: {err}")
                    else:
                        raw["deadlineTime"] = pos.get("deadlineTime")
                        dl = parse_deadline(pos.get("deadlineTime") or "")
                        if dl is not None:
                            parsed["deadline_date"] = dl.isoformat()

                need_industry = not (row.industry or "").strip()
                if need_industry:
                    industry, err = fetch_industry(uuid)
                    if err:
                        errors.append(f"search: {err}")
                    else:
                        raw["industry"] = industry
                        if industry:
                            parsed["industry"] = industry

                rec["raw"], rec["parsed"] = raw, parsed
                if errors:
                    rec.update(action="error", error="; ".join(errors))
                    stats["error"] += 1
                elif not parsed:
                    rec["action"] = "skipped"
                    rec["reason"] = "no parsable value"
                    stats["skipped"] += 1
                else:
                    rec["action"] = "filled"
                    if not dry_run:
                        obj = db.get(CampusJob, row.id)
                        if obj is not None:
                            if parsed.get("deadline_date") and obj.deadline_date is None:
                                obj.deadline_date = parse_deadline(parsed["deadline_date"])
                                if not (obj.deadline_text or "").strip():
                                    obj.deadline_text = (raw.get("deadlineTime")
                                                         or "")[:DEADLINE_TEXT_LIMIT]
                            if parsed.get("industry") and not (obj.industry or "").strip():
                                obj.industry = parsed["industry"][:INDUSTRY_LIMIT]
                    if "deadline_date" in parsed:
                        stats["deadline_filled"] += 1
                    if "industry" in parsed:
                        stats["industry_filled"] += 1
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
    parser = argparse.ArgumentParser(
        description="中智详情 API 补全 campus_jobs.deadline_date/industry")
    parser.add_argument("--dry-run", action="store_true", help="只抓取解析不写库")
    parser.add_argument("--limit", type=int, default=0, help="最多处理 N 条")
    parser.add_argument("--audit", default="", help="JSONL 审计文件路径")
    args = parser.parse_args()
    enrich(dry_run=args.dry_run, limit=args.limit, audit_path=args.audit)


if __name__ == "__main__":
    main()
