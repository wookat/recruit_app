"""采集 NCSS 全国大学生就业服务平台 (job.ncss.cn，教育部) 校招职位，增量导入 campus_jobs。

数据源（合法公开 JSON 接口，无需登录/Cookie/验证码）：
    GET https://job.ncss.cn/student/jobs/jobslist/ajax/
    参数：offset=页码(1起) limit=20(固定，传更大无效)
          areaCode=省份码 property=单位性质 categoryCode=职位类别 degreeCode=学历码
    返回：data.pagenation.count 恒为 200（不反映真实总数，不可用）；
    未登录实际窗口上限 5 页 × 20 条 = 100 条（offset≥6 返回 flag=false），
    以页面是否拉满判断触顶。

分片策略（单查询窗口封顶 100 条）：
    单位性质 property × 省份 areaCode × 职位类别 categoryCode 枚举；
    单分片拉满 5 页（触顶）时再按学历 degreeCode 细分，按 jobId 去重。

字段映射（source_table='NCSS'，全部入 campus_jobs）：
    recName→company  jobName→positions  recProperty→company_type
    degreeName→edu_requirement  major→major_requirement  areaCodeName→locations
    publishDate→start_date  updateDate→updated_at_src
    jobId→announce_url(https://job.ncss.cn/student/jobs/{jobId}/detail.html)
    列表接口不含截止日期，deadline 留空。

去重与更新：
    沿用 content_hash（import_campus.row_hash）跨源唯一约束，重复跳过；
    同 job_id（announce_url 内含）再次出现且字段有变化时更新原记录。

用法：
    python collect_ncss.py --dry-run           # 只枚举分片统计可采条数，不入库
    python collect_ncss.py --limit 500         # 试跑：最多拉取 500 条职位后入库
    python collect_ncss.py                     # 全量增量采集入库
"""
import argparse
import json
import re
import time
from datetime import datetime, timezone, timedelta

import requests

from sqlalchemy import text

import cache
import import_campus
from database import Base, SessionLocal, engine
from models import CampusJob

API_LIST = "https://job.ncss.cn/student/jobs/jobslist/ajax/"

HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://job.ncss.cn/student/jobs/index.html",
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": "Mozilla/5.0 (compatible; shangan-leida-collector; +https://jobs.zalize.com)",
}

PROVINCE_CODES = [
    "11", "12", "13", "14", "15", "21", "22", "23", "31", "32", "33", "34",
    "35", "36", "37", "41", "42", "43", "44", "45", "46", "50", "51", "52",
    "53", "54", "61", "62", "63", "64", "65",
]
PROPERTIES = ["国有企业", "机关/事业单位/非营利机构"]
CATEGORY_CODES = [""] + [f"{i:02d}" for i in range(1, 30)]
DEGREE_CODES = ["51", "41", "31", "11", "01"]

PAGE_SIZE = 20
MAX_PAGES = 5  # 未登录窗口：offset≥6 返回 flag=false
REQUEST_INTERVAL = 1.0  # 限速：每请求间隔 ≥1s
TIMEOUT = 30

SOURCE_TABLE = "NCSS"
BATCH = "校园招聘"
CAMPUS_LIMITS = {"company": 300, "company_type": 50, "batch": 100, "grad_years": 100,
                 "edu_requirement": 200, "locations": 500, "start_date": 30,
                 "deadline_text": 200, "updated_at_src": 30}

_GRAD_YEAR_RE = re.compile(r"(20\d{2})\s*[届级]")
_CST = timezone(timedelta(hours=8))

_last_request_at = 0.0


def _throttle():
    global _last_request_at
    wait = REQUEST_INTERVAL - (time.time() - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    _last_request_at = time.time()


def _get(params: dict, retries: int = 3) -> dict:
    for attempt in range(retries + 1):
        try:
            _throttle()
            r = requests.get(API_LIST, params=params, headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            res = r.json()
            if not res.get("flag"):
                raise RuntimeError(f"ncss API flag=false errors={res.get('errors')}")
            return res.get("data") or {}
        except Exception as exc:  # noqa: BLE001
            if attempt < retries:
                time.sleep(2.0 * (attempt + 1))
                continue
            print(f"[warn] ncss fetch {params}: {exc}")
            return {}


def fetch_shard(search: dict) -> tuple:
    """拉取一个分片全部页：返回 (dict jobId->item, 是否触顶)。

    pagenation.count 恒为 200 不可信，以「拉满 MAX_PAGES 页且末页满页」判定触顶。"""
    items = {}
    last_full = False
    for page in range(1, MAX_PAGES + 1):
        data = _get({"offset": page, "limit": PAGE_SIZE, **search})
        batch = data.get("list") or []
        for it in batch:
            if it.get("jobId"):
                items[it["jobId"]] = it
        last_full = len(batch) >= PAGE_SIZE
        if not last_full:
            break
    return items, last_full


def iter_all_jobs(verbose: bool = False):
    """枚举分片：性质×省×类别 → 触顶按学历细分，逐条 yield 职位。"""
    for prop in PROPERTIES:
        for area in PROVINCE_CODES:
            for cat in CATEGORY_CODES:
                search = {"property": prop, "areaCode": area, "categoryCode": cat}
                items, capped = fetch_shard(search)
                if capped:
                    if verbose:
                        print(f"  触顶细分: {prop}/{area}/cat={cat or '-'}", flush=True)
                    for deg in DEGREE_CODES:
                        d_search = dict(search)
                        d_search["degreeCode"] = deg
                        d_items, _ = fetch_shard(d_search)
                        items.update(d_items)
                yield from items.values()


def _date_of(ms) -> str:
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=_CST).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError):
        return ""


def grad_years_of(item: dict) -> str:
    years = sorted(set(_GRAD_YEAR_RE.findall(item.get("jobName") or "")))
    return "、".join(f"{y}届" for y in years)


def detail_url(item: dict) -> str:
    return f"https://job.ncss.cn/student/jobs/{item.get('jobId', '')}/detail.html"


def _salary_of(item: dict) -> str:
    low, high = item.get("lowMonthPay"), item.get("highMonthPay")
    if low and high:
        return f"{low}-{high}k/月"
    return ""


def to_campus_row(item: dict) -> dict:
    notes_parts = []
    if item.get("headCount"):
        notes_parts.append(f"招聘人数：{item['headCount']}")
    salary = _salary_of(item)
    if salary:
        notes_parts.append(f"月薪：{salary}")
    if item.get("sourcesNameCh"):
        notes_parts.append(f"信息发布来源：{item['sourcesNameCh']}")
    major = (item.get("major") or "").strip()
    return {
        "company": (item.get("recName") or "").strip(),
        "positions": (item.get("jobName") or "").strip(),
        "company_type": (item.get("recProperty") or "").strip() or "央国企",
        "batch": BATCH,
        "grad_years": grad_years_of(item),
        "edu_requirement": (item.get("degreeName") or "").strip(),
        "major_requirement": "" if major == "不限专业" else major,
        "locations": (item.get("areaCodeName") or "").strip(),
        "start_date": _date_of(item.get("publishDate")),
        "deadline_text": "",
        "deadline_date": None,
        "announce_url": detail_url(item),
        "notes": "；".join(notes_parts),
        "updated_at_src": _date_of(item.get("updateDate") or item.get("publishDate")),
    }


CAMPUS_UPDATABLE = ["positions", "company_type", "batch", "grad_years", "edu_requirement",
                    "major_requirement", "locations", "start_date", "notes",
                    "updated_at_src"]


class Ingestor:
    """按 content_hash 去重、按 announce_url（含 jobId）更新已有记录。"""

    def __init__(self, db):
        self.db = db
        self.campus_hashes = {h for (h,) in db.execute(
            text("SELECT content_hash FROM campus_jobs"))}
        self.campus_by_url = {r.announce_url: r.id for r in db.execute(text(
            "SELECT id, announce_url FROM campus_jobs WHERE source_table = :st"),
            {"st": SOURCE_TABLE})}
        self.stats = {"added": 0, "updated": 0, "dup": 0, "skipped": 0}

    def ingest(self, item: dict, dry_run: bool = False):
        d = to_campus_row(item)
        if not d["company"]:
            self.stats["skipped"] += 1
            return
        h = import_campus.row_hash(SOURCE_TABLE, {k: (v or "") for k, v in d.items()
                                                  if isinstance(v, str)})
        url = d["announce_url"]
        existing_id = self.campus_by_url.get(url)
        if existing_id is not None:
            if not dry_run and self._update(existing_id, d):
                self.stats["updated"] += 1
            else:
                self.stats["dup"] += 1
            return
        if h in self.campus_hashes:
            self.stats["dup"] += 1
            return
        self.campus_hashes.add(h)
        self.stats["added"] += 1
        if dry_run:
            return
        for k, lim in CAMPUS_LIMITS.items():
            if isinstance(d.get(k), str) and d[k]:
                d[k] = d[k][:lim]
        self.db.add(CampusJob(source_table=SOURCE_TABLE, content_hash=h, **d))
        self.campus_by_url[url] = -1

    def _update(self, row_id: int, d: dict) -> bool:
        if row_id < 0:
            return False
        obj = self.db.get(CampusJob, row_id)
        if obj is None:
            return False
        changed = False
        for k in CAMPUS_UPDATABLE:
            new = d.get(k)
            if isinstance(new, str) and not new:
                continue
            if getattr(obj, k, None) != new:
                setattr(obj, k, new)
                changed = True
        return changed


def collect(dry_run: bool = False, limit: int = 0) -> dict:
    db = SessionLocal()
    fetched = 0
    try:
        Base.metadata.create_all(bind=engine, tables=[CampusJob.__table__])
        ing = Ingestor(db)
        print("== 枚举 NCSS 分片（性质×省×类别）")
        seen_ids = set()
        for item in iter_all_jobs(verbose=True):
            jid = item.get("jobId")
            if jid in seen_ids:
                continue
            seen_ids.add(jid)
            ing.ingest(item, dry_run=dry_run)
            fetched += 1
            if not dry_run and fetched % 500 == 0:
                db.commit()
            if limit and fetched >= limit:
                break
        if not dry_run:
            db.commit()
            cache.invalidate_prefixes(
                "campus_filters", "campus_counts", "campus_timeline",
            )
        result = {"dry_run": dry_run, "fetched": fetched, **ing.stats}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return result
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="采集 NCSS 校招职位入库 campus_jobs")
    parser.add_argument("--dry-run", action="store_true", help="只统计不入库")
    parser.add_argument("--limit", type=int, default=0, help="最多拉取 N 条职位（试跑）")
    args = parser.parse_args()
    collect(dry_run=args.dry_run, limit=args.limit)


if __name__ == "__main__":
    main()
