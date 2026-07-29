"""抓取 xduim.com 国家公务员（国考）职位库，按工作地省份分页抓取。

用法:
    python scrape_xduim_guokao.py --years 2025 2026 --out ../exports/guokao
"""
import argparse
import os
import re
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import StringIO

sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import requests
from export_utils import export_csv_sql

BASE = "https://www.xduim.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

WORK_CITIES = [
    "北京市", "天津市", "河北省", "山西省", "内蒙古", "辽宁省", "吉林省", "黑龙江省",
    "上海市", "江苏省", "浙江省", "安徽省", "福建省", "江西省", "山东省", "河南省",
    "湖北省", "湖南省", "广东省", "广西", "海南省", "重庆市", "四川省", "贵州省",
    "云南省", "西藏", "陕西省", "甘肃省", "青海省", "宁夏", "新疆",
]


def _clean(val):
    if pd.isna(val) or val is None:
        return ""
    s = str(val).strip()
    return s if s.lower() not in ("nan", "none", "—", "-", "无") else ""


def _read_html(html: str):
    try:
        dfs = pd.read_html(StringIO(html))
        return dfs[0] if dfs else pd.DataFrame()
    except Exception:
        try:
            dfs = pd.read_html(StringIO(html), flavor="html5lib")
            return dfs[0] if dfs else pd.DataFrame()
        except Exception:
            return pd.DataFrame()


def fetch_page(work_city: str, year: int, page: int, retries: int = 3):
    q = urllib.parse.quote(work_city)
    url = f"{BASE}/zw/guokao/list?work_city={q}&year={year}&curPage={page}"
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            r.encoding = "utf-8"
            m = re.search(r'value="(\d+)/(\d+)"', r.text)
            total_pages = int(m.group(2)) if m else 1
            return total_pages, _read_html(r.text)
        except Exception as exc:
            if attempt < retries:
                time.sleep(1.0 * (attempt + 1))
                continue
            print(f"[warn] fetch guokao/{work_city}/{year} page {page}: {exc}")
            return 1, pd.DataFrame()


def _split_major(text: str):
    if not text:
        return "", ""
    s = str(text).strip()
    u, g = "", ""
    m = re.split(r"研究生[:：]?", s, maxsplit=1)
    if len(m) == 2:
        g = m[1].strip(" ，；;")
        u = re.sub(r"^(大学本科|本科)[:：]?", "", m[0]).strip(" ，；;")
    else:
        u = re.sub(r"^(大学本科|本科)[:：]?", "", s).strip(" ，；;")
    return u, g


def transform(df: pd.DataFrame, year: int) -> pd.DataFrame:
    if df.empty:
        return df
    df = df.rename(columns=lambda c: str(c).strip())
    rows = []
    for _, r in df.iterrows():
        code = _clean(r.get("职位代码"))
        employer = _clean(r.get("部门名称"))
        work_loc = _clean(r.get("工作地点"))
        position_example = f"{code} {employer}".strip()
        edu = _clean(r.get("学历"))
        major = _clean(r.get("专业"))
        u_major, g_major = _split_major(major)

        spec_items = []
        for col, label in [
            ("政治面貌", "政治面貌"), ("应届生", "招考对象"), ("性别", "性别"),
            ("基层年限", "基层工作年限"), ("招聘人数", "招聘人数"), ("报名人数", "报名人数"),
            ("资审合格", "资审合格"),
        ]:
            v = _clean(r.get(col))
            if v:
                spec_items.append(f"{label}：{v}")

        rows.append({
            "year": year,
            "工作类型": "公务员",
            "考试/招聘类型": f"{year}国家公务员考试",
            "用人单位/系统": employer,
            "岗位示例": position_example,
            "学历要求": edu,
            "本科生专业要求": u_major,
            "研究生专业要求": g_major,
            "考试/招聘形式": "笔试+面试",
            "报名时间": "",
            "笔试/考试时间": "",
            "特殊要求": "；".join(spec_items),
            "工作地点": work_loc,
            "信息来源": f"{BASE}/zw/guokao",
            "备注": "",
            "专业要求（原始）": f"专业：{major}" if major else "",
        })
    return pd.DataFrame(rows)


def scrape_year(year: int, max_workers: int = 6):
    all_dfs = []
    pending = [(city, 1) for city in WORK_CITIES]
    stats = {"pages": 0}

    def worker(city, page):
        total_pages, df = fetch_page(city, year, page)
        stats["pages"] += 1
        if stats["pages"] % 100 == 0:
            print(f"[guokao {year}] pages={stats['pages']} pending={len(pending)} chunks={len(all_dfs)}")
        if page == 1 and total_pages > 1:
            for p in range(2, total_pages + 1):
                pending.append((city, p))
        if not df.empty:
            all_dfs.append(df)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}

        def submit_up_to(limit=40):
            while pending and len(futures) < limit:
                city, page = pending.pop(0)
                futures[executor.submit(worker, city, page)] = True

        submit_up_to()
        while futures:
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception as exc:
                    print(f"[warn] guokao worker error: {exc}")
                futures.pop(fut, None)
                submit_up_to()
                break

    print(f"[guokao {year}] total pages={stats['pages']} chunks={len(all_dfs)}")
    if not all_dfs:
        return pd.DataFrame()
    df = pd.concat([transform(d, year) for d in all_dfs], ignore_index=True)
    df = df[df["岗位示例"].str.len() > 0]
    df = df.drop_duplicates()
    return df


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=int, nargs="+", default=[2025, 2026])
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "exports", "guokao"))
    args = parser.parse_args()
    for year in args.years:
        print(f"=== scraping {year} guokao from xduim.com ===")
        df = scrape_year(year)
        print(f"{year} rows: {len(df)}")
        if not df.empty:
            n = export_csv_sql(df, f"{args.out}_{year}", default_year=year)
            print(f"exported {n} unique records -> {args.out}_{year}.csv/.sql")
