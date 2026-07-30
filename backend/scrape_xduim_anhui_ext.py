"""抓取 xduim.com 安徽专区扩展板块：选调生/事业单位/公安法检/三支一扶/教师招考/国考历年（安徽）。

各板块的有效参数组合直接从板块首页 (/zw/<section>) 的链接中提取，
再对每个链接叠加首页出现过的全部年份，逐页抓取。

用法:
    python scrape_xduim_anhui_ext.py --sections xuandiao sydw gafj szyf jszk --out ../exports/anhui
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

SECTIONS = {
    "xuandiao": {"job_type": "选调生", "exam_type": "{year}安徽省选调生"},
    "sydw": {"job_type": "事业单位", "exam_type": "{year}安徽事业单位招聘"},
    "gafj": {"job_type": "公务员", "exam_type": "{year}安徽公安法检招录"},
    "szyf": {"job_type": "三支一扶", "exam_type": "{year}安徽三支一扶招募"},
    "jszk": {"job_type": "教师", "exam_type": "{year}安徽教师招考"},
    "gklx": {"job_type": "公务员", "exam_type": "{year}安徽公开遴选"},
}


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


def get_seeds(section: str):
    """Return (list of query strings, sorted years) discovered on the section index page."""
    url = f"{BASE}/zw/{section}"
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.encoding = "utf-8"
    hrefs = set(re.findall(rf'href="/zw/{section}/list\?([^"]+)"', r.text))
    years = sorted({int(y) for y in re.findall(r"year=(\d{4})", r.text)})
    queries = set()
    for h in hrefs:
        params = urllib.parse.parse_qs(h)
        params.pop("year", None)
        params.pop("curPage", None)
        base_q = urllib.parse.urlencode({k: v[0] for k, v in params.items()})
        if years:
            for y in years:
                queries.add(f"{base_q}&year={y}")
        else:
            queries.add(base_q)
    return sorted(queries), years


def fetch_page(section: str, query: str, page: int, retries: int = 3):
    url = f"{BASE}/zw/{section}/list?{query}&curPage={page}"
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
            print(f"[warn] fetch {section}?{query} page {page}: {exc}")
            return 1, pd.DataFrame()


_EMPLOYER_COLS = ["招聘单位", "主管部门", "学校（单位）", "高校", "招考部门", "单位名称"]
_SPECIAL_COLS = [
    "招考批次", "招募类别", "学段", "学科", "招聘职位", "服务单位", "性别", "年龄",
    "应届生", "政治面貌", "招聘人数", "报名人数", "合格人数", "缴费人数",
    "分数线", "最高分", "最高分数", "平均分", "城市",
]


def transform(df: pd.DataFrame, section: str, year: int) -> pd.DataFrame:
    if df.empty:
        return df
    cfg = SECTIONS[section]
    df = df.rename(columns=lambda c: str(c).strip())
    rows = []
    for _, r in df.iterrows():
        code = _clean(r.get("职位代码"))
        region = _clean(r.get("地区"))
        employer = ""
        for col in _EMPLOYER_COLS:
            employer = _clean(r.get(col))
            if employer:
                break
        title = _clean(r.get("招聘职位"))
        parts = [p for p in [code, employer, title] if p]
        position_example = " ".join(parts)
        edu = _clean(r.get("学历"))
        major = _clean(r.get("专业"))

        spec_items = []
        for col in _SPECIAL_COLS:
            v = _clean(r.get(col))
            if v:
                spec_items.append(f"{col}：{v}")

        rows.append({
            "year": year,
            "工作类型": cfg["job_type"],
            "考试/招聘类型": cfg["exam_type"].format(year=year),
            "用人单位/系统": employer,
            "岗位示例": position_example,
            "学历要求": edu,
            "本科生专业要求": major,
            "研究生专业要求": "",
            "考试/招聘形式": "笔试+面试",
            "报名时间": "",
            "笔试/考试时间": "",
            "特殊要求": "；".join(spec_items),
            "工作地点": f"安徽 {region}".strip(),
            "信息来源": f"{BASE}/zw/{section}",
            "备注": "",
            "专业要求（原始）": f"专业：{major}" if major else "",
        })
    return pd.DataFrame(rows)


def _year_of(query: str, fallback: int):
    m = re.search(r"year=(\d{4})", query)
    return int(m.group(1)) if m else fallback


def scrape_section(section: str, max_workers: int = 4, default_year: int = 2026):
    queries, years = get_seeds(section)
    print(f"[{section}] seeds={len(queries)} years={years}")
    all_chunks = []
    pending = [(q, 1) for q in queries]
    stats = {"pages": 0}

    def worker(query, page):
        total_pages, df = fetch_page(section, query, page)
        stats["pages"] += 1
        if stats["pages"] % 100 == 0:
            print(f"[{section}] pages={stats['pages']} pending={len(pending)} chunks={len(all_chunks)}")
        if page == 1 and total_pages > 1:
            for p in range(2, total_pages + 1):
                pending.append((query, p))
        if not df.empty:
            all_chunks.append((query, df))

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}

        def submit_up_to(limit=30):
            while pending and len(futures) < limit:
                q, p = pending.pop(0)
                futures[executor.submit(worker, q, p)] = True

        submit_up_to()
        while futures:
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception as exc:
                    print(f"[warn] {section} worker error: {exc}")
                futures.pop(fut, None)
                submit_up_to()
                break

    print(f"[{section}] total pages={stats['pages']} chunks={len(all_chunks)}")
    if not all_chunks:
        return pd.DataFrame()
    df = pd.concat(
        [transform(d, section, _year_of(q, default_year)) for q, d in all_chunks],
        ignore_index=True,
    )
    df = df[df["岗位示例"].str.len() > 0]
    df = df.drop_duplicates()
    return df


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sections", nargs="+", default=list(SECTIONS.keys()), choices=list(SECTIONS.keys()))
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "exports", "anhui"))
    parser.add_argument("--default-year", type=int, default=2026, help="链接中无 year 参数时使用的年份")
    args = parser.parse_args()
    for section in args.sections:
        print(f"=== scraping anhui {section} ===")
        df = scrape_section(section, default_year=args.default_year)
        print(f"{section} rows: {len(df)}")
        if not df.empty:
            n = export_csv_sql(df, f"{args.out}_{section}")
            print(f"exported {n} unique records -> {args.out}_{section}.csv/.sql")
