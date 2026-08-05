"""采集中智招聘网 (ciiczhaopin.com，央企中智 CIIC 旗下) 公开职位，增量导入 campus_jobs / bianzhi_jobs。

数据源（合法公开 JSON 接口，无需登录/Cookie/验证码，站点无 robots.txt 限制）：
    POST https://www.ciiczhaopin.com/api/position/search
    请求体：{"page":1,"size":100,"keyword":"","nature":"校招|", ...其余过滤维度传空}
    Header：Group-Name: zhaowen（前端 axiosConfig.js 固定注入，无需 Token）
    nature 过滤"职位性质"：'校招|' / '社招|'（worknature|postwholenature 组合，后半可空）；
    返回 result.total 为真实总数，分页无窗口上限（size=100/200 均可翻到末页），
    实测全站约 5800 条（校招 ~1100 / 社招 ~4700），单查询即可全量遍历，无需分片。

字段映射：
    校招 (worknature='校招') -> campus_jobs（source_table='中智'）
        orgname_show→company  jobname_show→positions  qualitative→company_type
        education_show→edu_requirement  workplace_show(省|市|区)→locations
        publishtime→start_date/updated_at_src  recnum_show/薪资/jobcate→notes
        positionUrl→announce_url；列表接口不含截止日期与专业字段，
        major 从 postdes_show 正文正则提取，deadline 留空。
    社招 (worknature='社招') 且公司性质为央国企/机关事业单位
        （中央企业/国有企业/事业单位/政府机关/央管协会单位）-> bianzhi_jobs（category='央国企社招'）；
    其余社招（民营/外资/合资等）-> campus_jobs（source_table='中智'，batch='社招'）。

去重与更新：
    沿用 content_hash（import_campus/import_bianzhi 的 row_hash）跨源唯一约束，重复跳过；
    同 job id（announce_url 内含 uuid）再次出现且字段有变化时更新原记录，
    只以非空新值覆盖，不清空已有可信字段。

用法：
    python collect_ciic.py --dry-run           # 只统计可采条数与分类，不入库
    python collect_ciic.py --limit 500         # 试跑：最多拉取 500 条职位后入库
    python collect_ciic.py                     # 全量增量采集入库
"""
import argparse
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

API_LIST = "https://www.ciiczhaopin.com/api/position/search"

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Group-Name": "zhaowen",
    "User-Agent": "Mozilla/5.0 (compatible; shangan-leida-collector; +https://jobs.zalize.com)",
}

NATURES = ["校招|", "社招|"]  # worknature|postwholenature，后半留空=不限

PAGE_SIZE = 100
REQUEST_INTERVAL = 1.0  # 限速：每请求间隔 ≥1s
TIMEOUT = 60

SOURCE_TABLE = "中智"
CAMPUS_LIMITS = {"company": 300, "company_type": 50, "batch": 100, "grad_years": 100,
                 "edu_requirement": 200, "locations": 500, "start_date": 30,
                 "deadline_text": 200, "updated_at_src": 30}
BIANZHI_CATEGORY = "央国企社招"
CENTRAL_SOE_NATURES = {"中央企业", "国有企业", "事业单位", "政府机关/非盈利组织",
                       "央管协会单位"}

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


def _search_payload(nature: str, page: int) -> dict:
    return {"page": page, "size": PAGE_SIZE, "keyword": "", "workplace": "",
            "industry": "", "jobcate": "", "qualitative": "", "education": "",
            "salary": "", "scale": "", "workexp": "", "attr": "", "disability": "",
            "nature": nature, "toppingcity": "", "id": "", "orgid": "",
            "orgcity_or": None, "workplace_or": None}


def _post(payload: dict, retries: int = 3) -> dict:
    for attempt in range(retries + 1):
        try:
            _throttle()
            r = requests.post(API_LIST, json=payload, headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            res = r.json()
            if res.get("code") != 0:
                raise RuntimeError(f"ciic API code={res.get('code')} msg={res.get('message')}")
            return res.get("result") or {}
        except Exception as exc:  # noqa: BLE001
            if attempt < retries:
                time.sleep(2.0 * (attempt + 1))
                continue
            print(f"[warn] ciic fetch page={payload.get('page')} nature={payload.get('nature')}: {exc}")
            return {}


def iter_nature_jobs(nature: str):
    """按页拉取一个职位性质的全部职位，按 id 去重，逐条 yield。"""
    seen = set()
    data = _post(_search_payload(nature, 1))
    total = int(data.get("total") or 0)
    print(f"  {nature} total={total}", flush=True)
    page = 1
    while True:
        batch = data.get("result") or []
        new = [x for x in batch if x.get("id") and x["id"] not in seen]
        for item in new:
            seen.add(item["id"])
            yield item
        if len(batch) < PAGE_SIZE or len(seen) >= total:
            break
        page += 1
        data = _post(_search_payload(nature, page))
        if not data:
            break


def _date_of(s: str) -> str:
    return (s or "").strip()[:10]


def _parse_date(s: str):
    try:
        return datetime.strptime(_date_of(s), "%Y-%m-%d").date()
    except ValueError:
        return None


def extract_major(item: dict) -> str:
    m = _MAJOR_RE.search(item.get("postdes_show") or "")
    return m.group(1).strip() if m else ""


def grad_years_of(item: dict) -> str:
    text_ = f"{item.get('jobname_show', '')} {(item.get('postdes_show') or '')[:500]}"
    years = sorted(set(_GRAD_YEAR_RE.findall(text_)))
    return "、".join(f"{y}届" for y in years)


def locations_of(item: dict) -> str:
    return (item.get("workplace_show") or "").strip().replace("|", "-")


def first_province(item: dict) -> str:
    wp = (item.get("workplace_show") or "").strip()
    return wp.split("|")[0] if wp else ""


def _salary_of(item: dict) -> str:
    low, up = item.get("sallow_show"), item.get("salup_show")
    unit = item.get("salunit_show") or "月薪"
    if low and up:
        return f"{low}-{up}（{unit}）"
    return ""


def _notes_of(item: dict) -> str:
    parts = []
    if item.get("recnum_show"):
        parts.append(f"招聘人数：{item['recnum_show']}")
    salary = _salary_of(item)
    if salary:
        parts.append(f"薪资：{salary}")
    if item.get("jobcate"):
        parts.append(f"职位类别：{item['jobcate']}")
    return "；".join(parts)


def detail_url(item: dict) -> str:
    return (item.get("positionUrl")
            or f"https://www.ciiczhaopin.com/position/detail?uuid={item.get('id', '')}")


def to_campus_row(item: dict, batch: str = "校园招聘") -> dict:
    return {
        "company": (item.get("orgname_show") or "").strip(),
        "positions": (item.get("jobname_show") or "").strip(),
        "company_type": (item.get("qualitative") or "").strip() or "央国企",
        "batch": batch,
        "grad_years": grad_years_of(item),
        "edu_requirement": (item.get("education_show") or "").strip(),
        "major_requirement": extract_major(item),
        "locations": locations_of(item),
        "start_date": _date_of(item.get("publishtime")),
        "deadline_text": "",
        "deadline_date": None,
        "announce_url": detail_url(item),
        "notes": _notes_of(item),
        "updated_at_src": _date_of(item.get("publishtime")),
    }


def to_bianzhi_row(item: dict) -> dict:
    return {
        "employer": (item.get("orgname_show") or "").strip(),
        "job_type": (item.get("qualitative") or "国企").strip(),
        "province": first_province(item),
        "work_location": locations_of(item)[:500],
        "edu_requirement": (item.get("education_show") or "").strip(),
        "major_requirement": extract_major(item),
        "headcount": (item.get("recnum_show") or "").strip(),
        "signup_start": _date_of(item.get("publishtime")),
        "deadline_text": "",
        "deadline_date": None,
        "announce_url": detail_url(item),
        "updated_at_src": _date_of(item.get("publishtime")),
    }


CAMPUS_UPDATABLE = ["positions", "company_type", "batch", "grad_years", "edu_requirement",
                    "major_requirement", "locations", "start_date", "notes",
                    "updated_at_src"]
BIANZHI_UPDATABLE = ["job_type", "province", "work_location", "edu_requirement",
                     "major_requirement", "headcount", "signup_start",
                     "updated_at_src"]


class Ingestor:
    """按 content_hash 去重、按 announce_url（含职位 uuid）更新已有记录。"""

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
            "AND announce_url LIKE 'https://www.ciiczhaopin.com/%'"),
            {"c": BIANZHI_CATEGORY})}
        self.stats = {"campus_added": 0, "campus_updated": 0, "campus_dup": 0,
                      "bianzhi_added": 0, "bianzhi_updated": 0, "bianzhi_dup": 0,
                      "skipped": 0}

    def ingest(self, item: dict, dry_run: bool = False):
        worknature = (item.get("worknature") or "").strip()
        if worknature == "校招":
            self._ingest_campus(item, dry_run)
        elif worknature == "社招":
            if (item.get("qualitative") or "").strip() in CENTRAL_SOE_NATURES:
                self._ingest_bianzhi(item, dry_run)
            else:
                self._ingest_campus(item, dry_run, batch="社招")
        else:
            self.stats["skipped"] += 1

    def _ingest_campus(self, item: dict, dry_run: bool, batch: str = "校园招聘"):
        d = to_campus_row(item, batch=batch)
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
    db = SessionLocal()
    fetched = 0
    try:
        Base.metadata.create_all(bind=engine,
                                 tables=[CampusJob.__table__, BianzhiJob.__table__])
        ing = Ingestor(db)
        for nature in NATURES:
            print(f"== 拉取中智 {nature.rstrip('|')} 职位")
            for item in iter_nature_jobs(nature):
                ing.ingest(item, dry_run=dry_run)
                fetched += 1
                if not dry_run and fetched % 500 == 0:
                    db.commit()
                if limit and fetched >= limit:
                    break
            if not dry_run:
                db.commit()
            if limit and fetched >= limit:
                break
        if not dry_run:
            db.commit()
            cache.invalidate_prefixes(
                "campus_filters", "campus_counts", "campus_timeline",
                "bianzhi_filters", "bianzhi_counts", "bianzhi_timeline",
            )
        result = {"dry_run": dry_run, "fetched": fetched, **ing.stats}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return result
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="采集中智招聘职位入库 campus_jobs / bianzhi_jobs")
    parser.add_argument("--dry-run", action="store_true", help="只统计不入库")
    parser.add_argument("--limit", type=int, default=0, help="最多拉取 N 条职位（试跑）")
    args = parser.parse_args()
    collect(dry_run=args.dry_run, limit=args.limit)


if __name__ == "__main__":
    main()
