"""采集国聘 iguopin.com 公开职位 API，增量导入 campus_jobs / bianzhi_jobs。

数据源（合法公开 JSON 接口，robots 全开放，不涉及登录/验证码/Cookie）：
    POST https://gp-api.iguopin.com/api/jobs/v1/list
    GET  https://gp-api.iguopin.com/api/base/districts/v1/tree

分片策略（实测 list 接口单查询窗口封顶约 4000 条 = 20 页 × 200）：
    招聘性质 nature（校招 115xW5oQ / 社招 113Fc6wc）× 省级 district 码枚举；
    单分片 total 触顶时再按地级市细分，仍触顶按学历码细分。
    超出窗口后接口会循环返回旧数据，按 job_id 去重并检测连续无新增即停。

字段映射：
    校园招聘 -> campus_jobs（source_table='国聘'）
    社会招聘（企业性质=国企/央企） -> bianzhi_jobs（category='央国企社招'）

去重与更新：
    沿用 content_hash（md5 关键字段拼接，import_campus/import_bianzhi 同款）唯一约束，
    重复跳过；同 job_id（announce_url 内含）再次出现且字段有变化时更新原记录。

用法：
    python collect_iguopin.py --dry-run           # 只枚举分片统计可采条数，不入库
    python collect_iguopin.py --limit 500         # 试跑：最多拉取 500 条职位后入库
    python collect_iguopin.py                     # 全量增量采集入库
"""
import argparse
import hashlib
import json
import re
import time
from datetime import datetime

import requests
from sqlalchemy import text

import cache
import import_bianzhi
import import_campus
from database import Base, SessionLocal, engine
from models import BianzhiJob, CampusJob

API_BASE = "https://gp-api.iguopin.com"
API_LIST = f"{API_BASE}/api/jobs/v1/list"
API_DISTRICTS = f"{API_BASE}/api/base/districts/v1/tree"

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Subsite": "iguopin",
    "User-Agent": "Mozilla/5.0 (compatible; shangan-leida-collector; +https://jobs.zalize.com)",
}

NATURE_CAMPUS = "115xW5oQ"  # 校招
NATURE_SOCIAL = "113Fc6wc"  # 社招
# 学历码（job_education 字典），触顶分片的最后一级
EDUCATION_CODES = ["115VXVUi", "116VSUN1", "116yhC4D", "11FRXBG",
                   "1129dbjh", "117A2ZJK", "113Auqab"]

PAGE_SIZE = 200
WINDOW_CAP = 4000  # 单查询窗口上限（20 页 × 200），total>=此值说明触顶需细分
MAX_PAGES = 20
REQUEST_INTERVAL = 0.5  # 限速：每请求间隔 ≥0.5s
TIMEOUT = 60

SOURCE_TABLE = "国聘"
CAMPUS_LIMITS = {"company": 300, "company_type": 50, "batch": 100, "grad_years": 100,
                 "edu_requirement": 200, "locations": 500, "start_date": 30,
                 "deadline_text": 200, "updated_at_src": 30}
BIANZHI_CATEGORY = "央国企社招"
CENTRAL_SOE_NATURES = {"国企", "央企", "中央企业", "国家机关", "事业单位"}

_TAG_RE = re.compile(r"<[^>]+>")
_MAJOR_RE = re.compile(
    r"(?:专业(?:要求|方向|背景|类别)?|所学专业)[：:为\s]{1,3}"
    r"([^。；;！!？?<>\n]{2,120})")
_GRAD_YEAR_RE = re.compile(r"(20\d{2})\s*届")

_last_request_at = 0.0


def _throttle():
    global _last_request_at
    wait = REQUEST_INTERVAL - (time.time() - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    _last_request_at = time.time()


def _post(payload: dict) -> dict:
    _throttle()
    r = requests.post(API_LIST, json=payload, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    res = r.json()
    if res.get("code") != 200:
        raise RuntimeError(f"iguopin API code={res.get('code')} msg={res.get('msg')}")
    return res["data"]


def probe_shard(search: dict) -> tuple:
    """探针一个分片：返回 (total, 首页 list)。

    接口的 total 字段封顶于 20×page_size，必须用 page_size=200 探针才能拿到
    窗口上限 4000 以内的真实总数；首页数据顺便复用避免重复请求。"""
    data = _post({"page": 1, "page_size": PAGE_SIZE, "keyword": "", **search})
    return int(data.get("total") or 0), data.get("list") or []


def fetch_province_tree() -> list:
    """地区字典树，返回省级节点列表 [{value,label,children:[市…]}]。"""
    _throttle()
    r = requests.get(API_DISTRICTS, headers={k: v for k, v in HEADERS.items()
                                             if k != "Content-Type"}, timeout=TIMEOUT)
    r.raise_for_status()
    res = r.json()
    if res.get("code") != 200:
        raise RuntimeError(f"districts API code={res.get('code')}")
    china = res["data"][0]
    return china.get("children") or []


def build_shards(provinces: list, nature: str, verbose: bool = False):
    """枚举分片：省 → 触顶按市 → 仍触顶按学历。yield (search_dict, total, 首页 list)。"""
    for prov in provinces:
        p_code = f"000000.{prov['value']}"
        search = {"nature": [nature], "district": [p_code]}
        total, first = probe_shard(search)
        if verbose:
            print(f"  {prov['label']}: {total}", flush=True)
        if total <= 0:
            continue
        if total < WINDOW_CAP:
            yield search, total, first
            continue
        for city in prov.get("children") or []:
            c_code = f"{p_code}.{city['value']}"
            c_search = {"nature": [nature], "district": [c_code]}
            c_total, c_first = probe_shard(c_search)
            if c_total <= 0:
                continue
            if c_total < WINDOW_CAP:
                yield c_search, c_total, c_first
                continue
            for edu in EDUCATION_CODES:
                e_search = {"nature": [nature], "district": [c_code],
                            "education": [edu]}
                e_total, e_first = probe_shard(e_search)
                if e_total > 0:
                    yield e_search, e_total, e_first


def iter_shard_jobs(search: dict, total: int, first_batch: list = None):
    """按页拉取一个分片，job_id 去重，超窗循环数据检测到即停。"""
    seen = set()
    stale = 0
    max_pages = min(MAX_PAGES, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    for page in range(1, max_pages + 1):
        if page == 1 and first_batch is not None:
            batch = first_batch
        else:
            try:
                data = _post({"page": page, "page_size": PAGE_SIZE, "keyword": "", **search})
            except Exception as exc:  # noqa: BLE001  单页失败跳过不阻断分片
                print(f"[warn] iguopin shard={search} page={page}: {exc}")
                continue
            batch = data.get("list") or []
        new = [x for x in batch if x.get("job_id") and x["job_id"] not in seen]
        for item in new:
            seen.add(item["job_id"])
            yield item
        if len(batch) < PAGE_SIZE:
            break
        if not new:
            stale += 1
            if stale >= 2:
                break
        else:
            stale = 0


def strip_html(s: str) -> str:
    return _TAG_RE.sub("", s or "").replace("&nbsp;", " ").strip()


def extract_major(item: dict) -> str:
    majors = item.get("major_cn") or []
    if majors:
        return "、".join(m for m in majors if m)[:2000]
    m = _MAJOR_RE.search(strip_html(item.get("contents") or ""))
    return m.group(1).strip() if m else ""


def locations_of(item: dict) -> str:
    parts = []
    for d in item.get("district_list") or []:
        area = (d.get("area_cn") or "").strip()
        if area and area not in parts:
            parts.append(area)
    return "、".join(parts)


def first_province(item: dict) -> str:
    for d in item.get("district_list") or []:
        area = (d.get("area_cn") or "").strip()
        if area:
            return area.split("-")[0]
    return ""


def _date_of(s: str) -> str:
    return (s or "").strip()[:10]


def _parse_date(s: str):
    try:
        return datetime.strptime(_date_of(s), "%Y-%m-%d").date()
    except ValueError:
        return None


def detail_url(item: dict) -> str:
    return f"https://www.iguopin.com/job/detail?id={item.get('job_id', '')}"


def grad_years_of(item: dict) -> str:
    text_ = f"{item.get('job_name', '')} {strip_html(item.get('contents') or '')[:500]}"
    years = sorted(set(_GRAD_YEAR_RE.findall(text_)))
    return "、".join(f"{y}届" for y in years)


def to_campus_row(item: dict) -> dict:
    company_nature = ((item.get("company_info") or {}).get("nature_cn") or "").strip()
    amount = item.get("amount")
    notes_parts = []
    if amount:
        notes_parts.append(f"招聘人数：{amount}")
    if item.get("category_cn"):
        notes_parts.append(f"职位类别：{item['category_cn']}")
    return {
        "company": (item.get("company_name") or "").strip(),
        "positions": (item.get("job_name") or "").strip(),
        "company_type": company_nature or "央国企",
        "batch": (item.get("recruitment_type_cn") or "").strip(),
        "grad_years": grad_years_of(item),
        "edu_requirement": (item.get("education_cn") or "").strip(),
        "major_requirement": extract_major(item),
        "locations": locations_of(item),
        "start_date": _date_of(item.get("start_time")),
        "deadline_text": _date_of(item.get("end_time")),
        "deadline_date": _parse_date(item.get("end_time")),
        "announce_url": detail_url(item),
        "notes": "；".join(notes_parts),
        "updated_at_src": _date_of(item.get("update_time") or item.get("start_time")),
    }


def to_bianzhi_row(item: dict) -> dict:
    return {
        "employer": (item.get("company_name") or "").strip(),
        "job_type": ((item.get("company_info") or {}).get("nature_cn") or "国企").strip(),
        "province": first_province(item),
        "work_location": locations_of(item)[:500],
        "edu_requirement": (item.get("education_cn") or "").strip(),
        "major_requirement": extract_major(item),
        "headcount": str(item.get("amount") or ""),
        "signup_start": _date_of(item.get("start_time")),
        "deadline_text": _date_of(item.get("end_time")),
        "deadline_date": _parse_date(item.get("end_time")),
        "announce_url": detail_url(item),
        "updated_at_src": _date_of(item.get("update_time") or item.get("start_time")),
    }


def _fields_digest(d: dict) -> str:
    key = json.dumps({k: str(v) for k, v in sorted(d.items())}, ensure_ascii=False)
    return hashlib.md5(key.encode("utf-8")).hexdigest()


CAMPUS_UPDATABLE = ["positions", "company_type", "batch", "grad_years", "edu_requirement",
                    "major_requirement", "locations", "start_date", "deadline_text",
                    "deadline_date", "notes", "updated_at_src"]
BIANZHI_UPDATABLE = ["job_type", "province", "work_location", "edu_requirement",
                     "major_requirement", "headcount", "signup_start", "deadline_text",
                     "deadline_date", "updated_at_src"]


class Ingestor:
    """按 content_hash 去重、按 announce_url（含 job_id）更新已有记录。"""

    def __init__(self, db):
        self.db = db
        self.campus_hashes = {h for (h,) in db.execute(
            text("SELECT content_hash FROM campus_jobs"))}
        self.bianzhi_hashes = {h for (h,) in db.execute(
            text("SELECT content_hash FROM bianzhi_jobs"))}
        self.campus_by_url = {r.announce_url: r.id for r in db.execute(text(
            "SELECT id, announce_url FROM campus_jobs WHERE source_table = :st"),
            {"st": SOURCE_TABLE})}
        self.bianzhi_by_url = {r.announce_url: r.id for r in db.execute(text(
            "SELECT id, announce_url FROM bianzhi_jobs WHERE category = :c "
            "AND announce_url LIKE 'https://www.iguopin.com/%'"),
            {"c": BIANZHI_CATEGORY})}
        self.stats = {"campus_added": 0, "campus_updated": 0, "campus_dup": 0,
                      "bianzhi_added": 0, "bianzhi_updated": 0, "bianzhi_dup": 0,
                      "skipped": 0}

    def ingest(self, item: dict, dry_run: bool = False):
        rtype = (item.get("recruitment_type_cn") or "").strip()
        nature_cn = (item.get("nature_cn") or "").strip()
        if rtype == "校园招聘" or nature_cn == "校招":
            self._ingest_campus(item, dry_run)
        elif rtype == "社会招聘" or nature_cn == "社招":
            company_nature = ((item.get("company_info") or {}).get("nature_cn") or "").strip()
            if company_nature in CENTRAL_SOE_NATURES:
                self._ingest_bianzhi(item, dry_run)
            else:
                self.stats["skipped"] += 1
        else:
            self.stats["skipped"] += 1

    def _ingest_campus(self, item: dict, dry_run: bool):
        d = to_campus_row(item)
        if not d["company"]:
            self.stats["skipped"] += 1
            return
        h = import_campus.row_hash(SOURCE_TABLE, {k: (v or "") for k, v in d.items()
                                                  if isinstance(v, str)})
        url = d["announce_url"]
        existing_id = self.campus_by_url.get(url)
        if existing_id is not None:
            if not dry_run and self._update(CampusJob, existing_id, d, CAMPUS_UPDATABLE):
                self.stats["campus_updated"] += 1
            else:
                self.stats["campus_dup"] += 1
            return
        if h in self.campus_hashes:
            self.stats["campus_dup"] += 1
            return
        self.campus_hashes.add(h)
        self.stats["campus_added"] += 1
        if dry_run:
            return
        for k, lim in CAMPUS_LIMITS.items():
            if isinstance(d.get(k), str) and d[k]:
                d[k] = d[k][:lim]
        self.db.add(CampusJob(source_table=SOURCE_TABLE, content_hash=h, **d))
        self.campus_by_url[url] = -1

    def _ingest_bianzhi(self, item: dict, dry_run: bool):
        d = to_bianzhi_row(item)
        if not d["employer"]:
            self.stats["skipped"] += 1
            return
        h = import_bianzhi.row_hash(BIANZHI_CATEGORY, {k: (v or "") for k, v in d.items()
                                                       if isinstance(v, str)})
        url = d["announce_url"]
        existing_id = self.bianzhi_by_url.get(url)
        if existing_id is not None:
            if not dry_run and self._update(BianzhiJob, existing_id, d, BIANZHI_UPDATABLE):
                self.stats["bianzhi_updated"] += 1
            else:
                self.stats["bianzhi_dup"] += 1
            return
        if h in self.bianzhi_hashes:
            self.stats["bianzhi_dup"] += 1
            return
        self.bianzhi_hashes.add(h)
        self.stats["bianzhi_added"] += 1
        if dry_run:
            return
        for k, lim in import_bianzhi.LIMITS.items():
            if isinstance(d.get(k), str) and d[k]:
                d[k] = d[k][:lim]
        self.db.add(BianzhiJob(category=BIANZHI_CATEGORY, content_hash=h, **d))
        self.bianzhi_by_url[url] = -1

    def _update(self, model, row_id: int, d: dict, updatable: list) -> bool:
        if row_id < 0:
            return False
        obj = self.db.get(model, row_id)
        if obj is None:
            return False
        changed = False
        for k in updatable:
            new = d.get(k)
            if isinstance(new, str) and not new:
                continue
            if getattr(obj, k, None) != new:
                setattr(obj, k, new)
                changed = True
        return changed


def collect(dry_run: bool = False, limit: int = 0) -> dict:
    provinces = fetch_province_tree()
    db = SessionLocal()
    fetched = 0
    est = {"campus_total": 0, "social_total": 0}
    try:
        Base.metadata.create_all(bind=engine,
                                 tables=[CampusJob.__table__, BianzhiJob.__table__])
        ing = Ingestor(db)
        for nature, est_key in ((NATURE_CAMPUS, "campus_total"),
                                (NATURE_SOCIAL, "social_total")):
            label = "校招" if nature == NATURE_CAMPUS else "社招"
            print(f"== 枚举 {label} 分片（省级）")
            for search, total, first in build_shards(provinces, nature, verbose=True):
                est[est_key] += total
                if dry_run and not limit:
                    continue
                for item in iter_shard_jobs(search, total, first):
                    ing.ingest(item, dry_run=dry_run)
                    fetched += 1
                    if limit and fetched >= limit:
                        break
                if not dry_run:
                    db.commit()
                if limit and fetched >= limit:
                    break
            if limit and fetched >= limit:
                break
        if not dry_run:
            db.commit()
            cache.invalidate_prefixes(
                "campus_filters", "campus_counts", "campus_timeline",
                "bianzhi_filters", "bianzhi_counts", "bianzhi_timeline",
            )
        result = {"dry_run": dry_run, "fetched": fetched, **est, **ing.stats}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return result
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="采集国聘 iguopin 职位入库 campus_jobs / bianzhi_jobs")
    parser.add_argument("--dry-run", action="store_true", help="只统计不入库")
    parser.add_argument("--limit", type=int, default=0, help="最多拉取 N 条职位（试跑）")
    args = parser.parse_args()
    collect(dry_run=args.dry_run, limit=args.limit)


if __name__ == "__main__":
    main()
