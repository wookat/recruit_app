"""抓取国家大学生就业服务平台 (job.ncss.cn，教育部) 的国企/机关事业单位校招职位。

接口: https://job.ncss.cn/student/jobs/jobslist/ajax/
每个查询组合最多返回 10 页 × 20 条 = 200 条，因此按
省份(areaCode) × 单位性质(property) × 职位类别(categoryCode) 切片抓取，
命中上限时再按学历(degreeCode)细分，按 jobId 去重。

用法:
    python scrape_ncss_jobs.py --out ../exports/ncss_soe
"""
import argparse
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import requests
from export_utils import export_csv_sql

API = "https://job.ncss.cn/student/jobs/jobslist/ajax/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://job.ncss.cn/student/jobs/index.html",
    "X-Requested-With": "XMLHttpRequest",
}

PROVINCE_CODES = [
    "11", "12", "13", "14", "15", "21", "22", "23", "31", "32", "33", "34",
    "35", "36", "37", "41", "42", "43", "44", "45", "46", "50", "51", "52",
    "53", "54", "61", "62", "63", "64", "65",
]
PROPERTIES = ["国有企业", "机关/事业单位/非营利机构"]
CATEGORY_CODES = [""] + [f"{i:02d}" for i in range(1, 30)]
DEGREE_CODES = ["51", "41", "31", "11", "01"]

PAGE_LIMIT = 20
MAX_PAGES = 10


def fetch(params: dict, page: int, retries: int = 3):
    q = dict(params)
    q.update({"offset": page, "limit": PAGE_LIMIT})
    for attempt in range(retries + 1):
        try:
            r = requests.get(API, params=q, headers=HEADERS, timeout=30)
            r.raise_for_status()
            data = r.json().get("data") or {}
            return data.get("list") or []
        except Exception as exc:
            if attempt < retries:
                time.sleep(1.0 * (attempt + 1))
                continue
            print(f"[warn] fetch {q}: {exc}")
            return []


def fetch_combo(params: dict):
    """Fetch up to MAX_PAGES for one filter combo; returns dict jobId->item."""
    items = {}
    for page in range(1, MAX_PAGES + 1):
        batch = fetch(params, page)
        for it in batch:
            if it.get("jobId"):
                items[it["jobId"]] = it
        if len(batch) < PAGE_LIMIT:
            break
    return items


_YEAR_RE = re.compile(r"(20\d{2})\s*[届级]")


def _year_of(item, default_year: int) -> int:
    m = _YEAR_RE.search(item.get("jobName") or "")
    return int(m.group(1)) if m else default_year


def transform(items, default_year: int) -> pd.DataFrame:
    rows = []
    for it in items:
        rec_name = (it.get("recName") or "").strip()
        job_name = (it.get("jobName") or "").strip()
        major = (it.get("major") or "").strip()
        degree = (it.get("degreeName") or "").strip()
        prop = (it.get("recProperty") or "").strip()
        area = (it.get("areaCodeName") or "").strip()
        head = it.get("headCount")
        recruit_type = it.get("recruitType")
        year = _year_of(it, default_year)
        spec = []
        if head:
            spec.append(f"招聘人数：{head}")
        if recruit_type == "1":
            spec.append("招聘类别：校园招聘")
        if it.get("sourcesNameCh"):
            spec.append(f"信息发布高校：{it['sourcesNameCh']}")
        job_type = "事业单位" if "事业单位" in prop else "国企"
        rows.append({
            "year": year,
            "工作类型": job_type,
            "考试/招聘类型": f"{year}高校毕业生招聘（{prop or '国企'}·教育部国家大学生就业服务平台）",
            "用人单位/系统": rec_name,
            "岗位示例": f"{rec_name} {job_name}".strip(),
            "学历要求": degree,
            "本科生专业要求": major,
            "研究生专业要求": "",
            "考试/招聘形式": "网申+面试",
            "报名时间": "",
            "笔试/考试时间": "",
            "特殊要求": "；".join(spec),
            "工作地点": area,
            "信息来源": f"https://job.ncss.cn/student/jobs/{it.get('jobId')}/detail.html",
            "备注": "",
            "专业要求（原始）": f"专业：{major}" if major else "",
        })
    return pd.DataFrame(rows)


def run(out_prefix: str, default_year: int = 2026, max_workers: int = 8):
    all_items = {}
    combos = []
    for prop in PROPERTIES:
        for area in PROVINCE_CODES:
            for cat in CATEGORY_CODES:
                combos.append({"property": prop, "areaCode": area, "categoryCode": cat})
    done = 0
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(fetch_combo, c): c for c in combos}
        for fut in as_completed(futures):
            combo = futures[fut]
            try:
                items = fut.result()
            except Exception as exc:
                print(f"[warn] combo {combo}: {exc}")
                items = {}
            # 该组合命中 200 条上限时按学历再细分一层
            if len(items) >= PAGE_LIMIT * MAX_PAGES:
                for deg in DEGREE_CODES:
                    sub = dict(combo)
                    sub["degreeCode"] = deg
                    items.update(fetch_combo(sub))
            all_items.update(items)
            done += 1
            if done % 50 == 0:
                print(f"combos {done}/{len(combos)} unique jobs={len(all_items)}")

    print(f"Total unique jobs: {len(all_items)}")
    df = transform(list(all_items.values()), default_year)
    if df.empty:
        print("no data")
        return
    print("Year distribution:", df["year"].value_counts().to_dict())
    n = export_csv_sql(df, out_prefix, default_year=default_year)
    print(f"exported {n} unique records -> {out_prefix}.csv/.sql")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "exports", "ncss_soe"))
    parser.add_argument("--default-year", type=int, default=2026)
    args = parser.parse_args()
    run(args.out, default_year=args.default_year)
