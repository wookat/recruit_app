"""抓取高校人才网 (gaoxiaojob.com) 的高校/科研院所/事业单位人才引进职位。

接口: https://www.gaoxiaojob.com/job/home-list?currentPage=N（需 XHR 头）
匿名访问只能翻公开列表（约千条），按 jobId 去重、连续无新增即停止。

用法:
    python scrape_gaoxiaojob.py --out ../exports/gaoxiaojob
"""
import argparse
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import requests
from export_utils import export_csv_sql

API = "https://www.gaoxiaojob.com/job/home-list"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.gaoxiaojob.com/job",
    "X-Requested-With": "XMLHttpRequest",
}

EDU_MAP = {"1": "大专", "2": "本科", "3": "硕士研究生", "4": "博士研究生"}

_YEAR_RE = re.compile(r"(20\d{2})\s*[届年级]")


def fetch_page(page: int, retries: int = 3):
    for attempt in range(retries + 1):
        try:
            r = requests.get(API, params={"currentPage": page}, headers=HEADERS, timeout=30)
            r.raise_for_status()
            res = r.json()
            if res.get("code") != 200:
                return []
            return (res.get("data") or {}).get("list") or []
        except Exception as exc:
            if attempt < retries:
                time.sleep(1.0 * (attempt + 1))
                continue
            print(f"[warn] page {page}: {exc}")
            return []


def transform(items, default_year: int) -> pd.DataFrame:
    rows = []
    for it in items:
        job_name = (it.get("jobName") or "").strip()
        company = (it.get("companyName") or "").strip()
        edu = (it.get("education") or "").strip() or EDU_MAP.get(str(it.get("educationType") or ""), "")
        city = " ".join(s for s in [(it.get("city") or "").strip(), (it.get("areaName") or "").strip()] if s)
        amount = (it.get("amount") or "").strip()
        m = _YEAR_RE.search(job_name)
        year = int(m.group(1)) if m else default_year
        spec = []
        if amount:
            spec.append(f"招聘人数：{amount}")
        tags = it.get("welfareTagArr")
        if isinstance(tags, list) and tags:
            spec.append("待遇标签：" + "/".join(str(t) for t in tags[:6]))
        if it.get("wage"):
            spec.append(f"薪酬：{it['wage']}")
        if str(it.get("isEstablishment")) == "1":
            spec.append("有编制")
        if it.get("companyNatureName"):
            spec.append(f"单位性质：{it['companyNatureName']}")
        rows.append({
            "year": year,
            "工作类型": "事业单位",
            "考试/招聘类型": f"{year}高校/科研院所人才引进（高校人才网）",
            "用人单位/系统": company,
            "岗位示例": f"{company} {job_name}".strip(),
            "学历要求": edu,
            "本科生专业要求": "",
            "研究生专业要求": "",
            "考试/招聘形式": "网申+考核",
            "报名时间": "",
            "笔试/考试时间": "",
            "特殊要求": "；".join(spec),
            "工作地点": city,
            "信息来源": it.get("url") or f"https://www.gaoxiaojob.com/job/detail/{it.get('jobId')}.html",
            "备注": (it.get("announcementName") or "").strip(),
            "专业要求（原始）": "",
        })
    return pd.DataFrame(rows)


def run(out_prefix: str, default_year: int = 2026, max_pages: int = 200, stale_limit: int = 5):
    items = {}
    stale = 0
    for page in range(1, max_pages + 1):
        batch = fetch_page(page)
        prev = len(items)
        for it in batch:
            if it.get("jobId"):
                items[it["jobId"]] = it
        if not batch or len(items) == prev:
            stale += 1
            if stale >= stale_limit:
                break
        else:
            stale = 0
        if page % 10 == 0:
            print(f"page {page} unique={len(items)}")
        time.sleep(0.2)
    print(f"Total unique jobs: {len(items)}")
    df = transform(list(items.values()), default_year)
    if df.empty:
        print("no data")
        return
    n = export_csv_sql(df, out_prefix, default_year=default_year)
    print(f"exported {n} unique records -> {out_prefix}.csv/.sql")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "exports", "gaoxiaojob"))
    parser.add_argument("--default-year", type=int, default=2026)
    args = parser.parse_args()
    run(args.out, default_year=args.default_year)
