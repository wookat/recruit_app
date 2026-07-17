#!/usr/bin/env python3
"""抓取中公全国事业单位职位系统 (zw.zgsydw.com) 的实际岗位入库。

用法:
    .venv/bin/python scrape_zw_zgsydw.py --years 2026 --max-concurrent 8
"""
import argparse
import hashlib
import json
import os
import random
import re
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

import pandas as pd
import requests
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.dirname(__file__))
from database import SessionLocal
from ingest import _compute_hash, _enrich_record
from models import Position

BASE = "http://zw.zgsydw.com"
INDEX_URL = f"{BASE}/web/retrieval/index"
SEARCH_URL = f"{BASE}/web/retrieval/searchIndex"
PROVINCE_LIST_URL = f"{BASE}/web/retrieval/getProvinceListByYear/"
PAGE_SIZE = 10
CAP = 10000
EDUCATIONS = ["中专", "专科", "本科", "硕士", "博士"]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Referer": INDEX_URL,
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/javascript, */*; q=0.01",
}

_tls = threading.local()


def _get_session(refresh: bool = False) -> Tuple[requests.Session, str]:
    if refresh or not hasattr(_tls, "session") or not _tls.session:
        s = requests.Session()
        s.headers.update(HEADERS)
        r = s.get(INDEX_URL, timeout=20)
        r.raise_for_status()
        text = r.text
        m = re.search(r'name="_token" value="([^"]+)"', text)
        if not m:
            raise RuntimeError("无法获取 CSRF token")
        _tls.session = s
        _tls.token = m.group(1)
    return _tls.session, _tls.token


def _encode_body(params: Dict[str, Any]) -> bytes:
    parts = []
    for k, v in params.items():
        if v is None:
            v = ""
        parts.append(f"{k}={v}")
    return "&".join(parts).encode("utf-8")


def _post(session: requests.Session, token: str, params: Dict[str, Any], retries: int = 3) -> dict:
    base = {
        "_token": token,
        "county": "",
        "education": "",
        "major": "",
        "FirstMajorCategory": "",
        "SecondMajorCategory": "",
        "fxparameter_val": "",
        "promo_scode": "",
        "promo_area": "",
        "bxzy": "0",
        "bxhj": "0",
        "bxsf": "0",
        "flag": "1",
        "draw": "1",
        "start": "0",
        "length": str(PAGE_SIZE),
        "order[0][column]": "0",
        "order[0][dir]": "desc",
        "search[value]": "",
        "search[regex]": "false",
    }
    base.update(params)
    body = _encode_body(base)
    hdrs = {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
    last_exc = None
    for attempt in range(retries):
        try:
            r = session.post(SEARCH_URL, data=body, headers=hdrs, timeout=30)
            if r.status_code == 200:
                try:
                    return r.json()
                except Exception as exc:
                    last_exc = exc
            elif r.status_code == 500 and "CSRF token mismatch" in r.text:
                # 刷新 token 并重试
                session, token = _get_session(refresh=True)
                base["_token"] = token
                body = _encode_body(base)
                continue
            else:
                last_exc = RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        except Exception as exc:
            last_exc = exc
        time.sleep(0.5 * (attempt + 1) + random.random())
    raise last_exc or RuntimeError("请求失败")


def _get_total(session: requests.Session, token: str, params: Dict[str, Any]) -> int:
    result = _post(session, token, params)
    total = result.get("recordsTotal", 0)
    return int(total) if total is not None else 0


def _fetch_page(session: requests.Session, token: str, params: Dict[str, Any], start: int) -> List[Dict[str, Any]]:
    p = params.copy()
    p["start"] = str(start)
    p["draw"] = str(start // PAGE_SIZE + 1)
    result = _post(session, token, p)
    return result.get("data", [])


def _parse_timestamp(v: Any) -> Optional[datetime]:
    if v is None or v == "" or v == 0:
        return None
    if isinstance(v, (int, float)):
        try:
            return datetime.fromtimestamp(int(v))
        except (ValueError, OSError, OverflowError):
            return None
    if isinstance(v, str):
        if v.isdigit():
            try:
                return datetime.fromtimestamp(int(v))
            except Exception:
                pass
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d"):
            try:
                return datetime.strptime(v.strip(), fmt)
            except ValueError:
                continue
    return None


def _format_time(v: Any) -> Optional[str]:
    dt = _parse_timestamp(v)
    return dt.strftime("%Y-%m-%d %H:%M") if dt else None


def _join_nonempty(*parts: Any, sep: str = " / ") -> str:
    vals = [str(p).strip() for p in parts if p is not None and str(p).strip() and str(p).strip().lower() != "nan"]
    return sep.join(vals)


def _split_major(raw: Optional[str]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    if not raw:
        return None, None, None
    text = str(raw).strip()
    if not text:
        return None, None, None
    undergrad = None
    grad = None
    patterns = [
        (r"研究生[：:\s]*(.+?)(?=本科[：:\s]|$)", "grad"),
        (r"硕士研究生[：:\s]*(.+?)(?=本科[：:\s]|$)", "grad"),
        (r"硕士[：:\s]*(.+?)(?=本科[：:\s]|$)", "grad"),
        (r"本科[：:\s]*(.+?)(?=研究生[：:\s]|硕士研究生[：:\s]|$)", "undergrad"),
    ]
    for pat, kind in patterns:
        for m in re.finditer(pat, text, flags=re.DOTALL):
            segment = m.group(1).strip("，,、；; ")
            if kind == "grad":
                grad = segment
            else:
                undergrad = segment
    if undergrad is None and grad is None:
        undergrad = grad = text
    return undergrad, grad, text


def _build_work_location(province: Optional[str], city: Optional[str], county: Optional[str]) -> str:
    parts = []
    for p in (province, city, county):
        if p and str(p).strip():
            s = str(p).strip()
            if not parts or s != parts[-1]:
                parts.append(s)
    return "-".join(parts)


def _build_special(item: Dict[str, Any]) -> str:
    pieces = []
    labels = {
        "bzxz": "编制性质",
        "identity": "身份要求",
        "xwyq": "学位要求",
        "ageyq": "年龄要求",
        "sex": "性别要求",
        "work_years": "工作年限",
        "zsyq": "证书/资格要求",
        "zzmmyq": "政治面貌",
        "hjyq": "户籍要求",
        "remark": "备注",
        "kstype": "考试类别",
        "zyks": "专业考试",
        "msxs": "面试形式",
        "cjbl": "成绩比例",
        "jfxs": "缴费方式",
        "jf_amount": "缴费金额",
        "zkrs": "招聘人数",
        "bmrs": "报名人数",
    }
    for key, label in labels.items():
        v = item.get(key)
        if v is None or v == "" or v == 0 or str(v).strip().lower() in ("nan", "null", "none"):
            continue
        if key in ("zkrs", "bmrs"):
            try:
                if int(v) <= 0:
                    continue
                pieces.append(f"{label}：{v}")
            except Exception:
                continue
        else:
            pieces.append(f"{label}：{v}")
    return "； ".join(pieces)


def _build_notes(item: Dict[str, Any]) -> str:
    pieces = []
    labels = {
        "ggmc": "公告名称",
        "gglink": "公告链接",
        "gwms": "岗位描述",
        "bs_content": "笔试内容",
        "jfxs": "缴费形式",
        "jf_amount": "缴费金额",
        "bmrs": "报名人数",
    }
    for key, label in labels.items():
        v = item.get(key)
        if not v or str(v).strip().lower() in ("nan", "null", "none", ""):
            continue
        if key == "bmrs":
            try:
                if int(v) <= 0:
                    continue
            except Exception:
                continue
        pieces.append(f"{label}：{v}")
    return "； ".join(pieces)


def _transform_item(item: Dict[str, Any]) -> Dict[str, Any]:
    undergrad, grad, raw_major = _split_major(item.get("major"))
    signup = _join_nonempty(
        _format_time(item.get("bm_starttime")),
        _format_time(item.get("bm_endtime")),
        sep=" 至 ",
    )
    exam_time = _format_time(item.get("bs_time")) or (item.get("bs_content") or "")
    exam_form = _join_nonempty(item.get("kstype"), item.get("bs_content"), sep=" ")
    work_loc = _build_work_location(item.get("province"), item.get("city"), item.get("county"))
    info_id = item.get("id")
    source_url = f"http://zw.zgsydw.com/web/retrieval/info/{info_id}"
    return {
        "year": item.get("year"),
        "工作类型": "事业单位/事业编",
        "考试/招聘类型": item.get("ggtype") or "事业单位招聘",
        "用人单位/系统": item.get("zkdw") or "",
        "岗位示例": item.get("gwmc") or "",
        "学历要求": item.get("xueli") or "不限",
        "本科生专业要求": undergrad,
        "研究生专业要求": grad,
        "考试/招聘形式": exam_form,
        "报名时间": signup,
        "笔试/考试时间": exam_time,
        "特殊要求": _build_special(item),
        "工作地点": work_loc,
        "信息来源": source_url,
        "备注": _build_notes(item),
        "专业要求（原始）": raw_major,
    }


def _get_provinces_and_cities(session: requests.Session, token: str, year: int) -> Tuple[Dict[int, str], Dict[str, List[str]]]:
    body = _encode_body({"timestamp": "", "_token": token, "year": str(year)})
    r = session.post(PROVINCE_LIST_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}, timeout=20)
    r.raise_for_status()
    result = r.json()
    rows = result.get("data", [])
    by_id = defaultdict(list)
    for row in rows:
        by_id[int(row["id"])].append(row["name"])

    province_id_to_name: Dict[int, str] = {}
    for pid, names in by_id.items():
        base = min(names, key=lambda x: (len(x), x))
        province_id_to_name[pid] = base

    province_name_to_cities: Dict[str, List[str]] = defaultdict(list)
    for pid, names in by_id.items():
        prov = province_id_to_name[pid]
        for name in names:
            if name == prov:
                continue
            if name.startswith(prov):
                city = name[len(prov):].strip()
                if city and city not in ("自治区", "维吾尔自治区", "回族自治区", "壮族自治区", "特别行政区"):
                    if city not in province_name_to_cities[prov]:
                        province_name_to_cities[prov].append(city)
    for prov in province_name_to_cities:
        if prov in ("北京", "上海", "天津", "重庆") and prov not in province_name_to_cities[prov]:
            province_name_to_cities[prov].append(prov)
    return province_id_to_name, {k: sorted(v, key=len, reverse=True) for k, v in province_name_to_cities.items()}


def _plan_queries(
    session: requests.Session,
    token: str,
    province_id_to_name: Dict[int, str],
    province_name_to_cities: Dict[str, List[str]],
    years: List[int],
    selected_provinces: Optional[Set[str]] = None,
) -> List[Tuple[str, int, str, str, int]]:
    plans: List[Tuple[str, int, str, str, int]] = []

    def total(prov: str, year: int, edu: str, city: str) -> int:
        return _get_total(session, token, {"province": prov, "year": str(year), "education": edu, "city": city})

    for pid, prov in sorted(province_id_to_name.items()):
        if selected_provinces and prov not in selected_provinces:
            continue
        for year in years:
            base_total = total(prov, year, "", "")
            if base_total == 0:
                continue
            if base_total < CAP:
                plans.append((prov, year, "", "", base_total))
                continue
            for edu in EDUCATIONS:
                edu_total = total(prov, year, edu, "")
                if edu_total == 0:
                    continue
                if edu_total < CAP:
                    plans.append((prov, year, edu, "", edu_total))
                    continue
                # edu_total == CAP：按城市拆分，城市合计不足 CAP 时再补一个 city=all 兜底
                cities = province_name_to_cities.get(prov, [])
                sum_cities = 0
                for city in (cities or []):
                    city_total = total(prov, year, edu, city)
                    if city_total:
                        plans.append((prov, year, edu, city, city_total))
                        sum_cities += min(city_total, CAP)
                if sum_cities < CAP:
                    plans.append((prov, year, edu, "", CAP))
    return plans


def _batch_ingest(db: Session, records: List[Dict[str, Any]], batch_size: int = 5000) -> int:
    if not records:
        return 0
    columns = [
        "year", "工作类型", "考试/招聘类型", "用人单位/系统", "岗位示例",
        "学历要求", "本科生专业要求", "研究生专业要求", "考试/招聘形式",
        "报名时间", "笔试/考试时间", "特殊要求", "工作地点", "信息来源",
        "备注", "专业要求（原始）",
    ]
    from ingest import _row_to_record, _POS_MAPPING
    total_inserted = 0
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        df = pd.DataFrame(batch, columns=columns)
        rows = []
        for _, row in df.iterrows():
            rec = _row_to_record(row, _POS_MAPPING, default_year=None)
            if not rec.get("exam_type") and not rec.get("position_example"):
                continue
            rec = _enrich_record(rec)
            rec["content_hash"] = _compute_hash(rec)
            rows.append(rec)
        if not rows:
            continue
        stmt = insert(Position).values(rows).on_conflict_do_nothing(index_elements=["content_hash"])
        result = db.execute(stmt)
        db.commit()
        total_inserted += result.rowcount
    return total_inserted


def _fetch_query_records(
    executor: ThreadPoolExecutor,
    prov: str,
    year: int,
    edu: str,
    city: str,
    total: int,
    max_pages_per_query: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """并发抓取单个查询的所有页，返回去重后的记录列表。"""
    pages = (min(total, CAP) + PAGE_SIZE - 1) // PAGE_SIZE
    if max_pages_per_query:
        pages = min(pages, max_pages_per_query)

    def page_task(start: int) -> List[Dict[str, Any]]:
        s, tok = _get_session()
        try:
            return _fetch_page(s, tok, {"province": prov, "year": str(year), "education": edu, "city": city}, start)
        except Exception as exc:
            print(f"[warn] page error {prov}/{year}/{edu}/{city} start={start}: {exc}")
            return []

    records: Dict[str, Dict[str, Any]] = {}
    futures = [executor.submit(page_task, i * PAGE_SIZE) for i in range(pages)]
    for fut in as_completed(futures):
        for item in fut.result():
            rec = _transform_item(item)
            if not rec["岗位示例"] and not rec["用人单位/系统"]:
                continue
            key = rec.get("信息来源", "")
            if not key:
                key = hashlib.md5(json.dumps(rec, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            if key not in records:
                records[key] = rec
    return list(records.values())


def scrape(
    years: List[int] = None,
    max_concurrent: int = 8,
    selected_provinces: Optional[List[str]] = None,
    max_pages_per_query: Optional[int] = None,
    batch_size: int = 5000,
) -> int:
    years = years or [2025, 2026]
    sel_set = set(selected_provinces) if selected_provinces else None
    session, token = _get_session()
    province_id_to_name, province_name_to_cities = _get_provinces_and_cities(session, token, years[0])
    plans = _plan_queries(session, token, province_id_to_name, province_name_to_cities, years, sel_set)
    print("计划查询数:", len(plans))
    estimated = sum(min(t, CAP) for _, _, _, _, t in plans)
    print("预计最多可抓取（含 10000 上限）:", estimated)

    db = SessionLocal()
    total_inserted = 0
    total_records = 0
    try:
        with ThreadPoolExecutor(max_workers=max_concurrent) as executor:
            for idx, (prov, year, edu, city, total) in enumerate(plans, 1):
                records = _fetch_query_records(executor, prov, year, edu, city, total, max_pages_per_query)
                inserted = _batch_ingest(db, records, batch_size=batch_size)
                db.commit()
                total_inserted += inserted
                total_records += len(records)
                print(f"[{idx}/{len(plans)}] {prov} {year} edu={edu or 'all'} city={city or 'all'} -> 本批 {len(records)} 条，新入库 {inserted} 条，累计新入库 {total_inserted} 条")
    finally:
        db.close()
    print(f"抓取完成，累计去重后 {total_records} 条，新入库 {total_inserted} 条")
    return total_inserted


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=int, nargs="+", default=[2025, 2026])
    parser.add_argument("--provinces", type=str, nargs="*", default=None, help="仅抓取指定省份（如 北京 广东）")
    parser.add_argument("--max-concurrent", type=int, default=8)
    parser.add_argument("--max-pages-per-query", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=5000)
    args = parser.parse_args()
    scrape(
        years=args.years,
        max_concurrent=args.max_concurrent,
        selected_provinces=args.provinces,
        max_pages_per_query=args.max_pages_per_query,
        batch_size=args.batch_size,
    )


if __name__ == "__main__":
    main()
