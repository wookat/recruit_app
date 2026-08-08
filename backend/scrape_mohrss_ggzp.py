"""抓取中国公共招聘网 (job.mohrss.gov.cn，人社部) 的机关/事业单位/国有单位岗位。

列表页服务端渲染，岗位 JSON 内嵌在 <input id="findjoblist" value='...'> 中。
按单位性质(aab019)与经济类型(aab020)过滤出体制内相关子集，逐页抓取并按
acb200(岗位ID)去重。

定位：手动按需采集器（不在 celery beat 定时内），导出 CSV/SQL 后经批量导入脚本入库。
R296 已用真实采集验证 R284 白名单过滤生效（国企类仅收 classify_soe_name='soe' 的行，
非白名单行计入 skipped 计数打印）。

用法:
    python scrape_mohrss_ggzp.py --out ../exports/mohrss_ggzp
"""
import argparse
import html as html_mod
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import requests
from export_utils import export_csv_sql
from soe_name_rules import classify_soe_name

BASE = "http://job.mohrss.gov.cn/cjobs/jobinfolist/listJobinfolist"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# aab019 单位性质 / aab020 经济类型
FILTERS = [
    ("aab019", "30", "机关"),
    ("aab019", "50", "事业单位"),
    ("aab019", "55", "全额拨款事业单位"),
    ("aab019", "56", "差额拨款事业单位"),
    ("aab019", "57", "自收自支事业单位"),
    ("aab020", "110", "国有全资"),
    ("aab020", "141", "国有联营"),
    ("aab020", "143", "国有与集体联营"),
    ("aab020", "151", "国有独资公司"),
]

EDU_MAP = {
    "11": "博士研究生", "14": "硕士研究生", "21": "大学本科", "31": "大学专科",
    "41": "中等专科", "44": "职业高中", "47": "技工学校", "61": "普通高中",
    "71": "初中", "81": "小学", "90": "其他",
}

_LIST_RE = re.compile(r'id="findjoblist"[^>]*value=(?:\'([^\']*)\'|"([^"]*)")', re.S)
_TOTAL_RE = re.compile(r'name="totalpages" value="(\d+)"')


def fetch_page(param: str, value: str, page: int, retries: int = 3):
    url = f"{BASE}?pageNo={page}&orderType=score&{param}={value}"
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=45)
            r.raise_for_status()
            m = _LIST_RE.search(r.text)
            items = json.loads(html_mod.unescape(m.group(1) or m.group(2))) if m else []
            tp = _TOTAL_RE.search(r.text)
            return (int(tp.group(1)) if tp else 1), items
        except Exception as exc:
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            print(f"[warn] {param}={value} page {page}: {exc}")
            return 1, []


def transform(records, default_year: int) -> pd.DataFrame:
    rows = []
    skipped_non_soe = 0
    for label, it in records:
        title = (it.get("aca112") or "").strip()
        employer = (it.get("aab004") or "").strip()
        # 经济类型（国有全资等）为单位自报，存在大量私企误报；
        # 国企类只收单位名白名单复核通过的行（R284）
        if "事业" not in label and label != "机关" \
                and classify_soe_name(employer) != "soe":
            skipped_non_soe += 1
            continue
        edu = EDU_MAP.get(str(it.get("aac011") or ""), "")
        desc = (it.get("acb22a") or "").strip()
        area = " ".join(s for s in [(it.get("area_") or "").strip(), (it.get("aab302") or "").strip()] if s)
        spec = []
        if it.get("acb240"):
            spec.append(f"招聘人数：{it['acb240']}")
        if it.get("acb241"):
            hi = it.get("acb242")
            spec.append(f"月薪：{it['acb241']}" + (f"-{hi}" if hi else "") + "元")
        spec.append(f"单位性质：{label}")
        if it.get("org_"):
            spec.append(f"发布机构：{it['org_']}")
        signup = ""
        if it.get("s_aae397") or it.get("s_aae398"):
            signup = f"{it.get('s_aae397') or ''} ~ {it.get('s_aae398') or ''}".strip()
        src = (it.get("ace760") or "").strip() or \
            f"http://job.mohrss.gov.cn/cjobs/jobinfolist/cb21/showgw?id={it.get('acb200')}"
        year = default_year
        m = re.search(r"(20\d{2})", str(it.get("s_aae397") or ""))
        if m:
            year = int(m.group(1))
        rows.append({
            "year": year,
            "工作类型": "事业单位" if ("事业" in label or label == "机关") else "国企",
            "考试/招聘类型": f"{year}公共招聘（{label}·中国公共招聘网）",
            "用人单位/系统": employer,
            "岗位示例": f"{employer} {title}".strip(),
            "学历要求": edu,
            "本科生专业要求": "",
            "研究生专业要求": "",
            "考试/招聘形式": "公开招聘",
            "报名时间": signup,
            "笔试/考试时间": "",
            "特殊要求": "；".join(spec),
            "工作地点": area,
            "信息来源": src,
            "备注": desc[:500],
            "专业要求（原始）": "",
        })
    if skipped_non_soe:
        print(f"skipped {skipped_non_soe} non-whitelisted SOE-labeled rows")
    return pd.DataFrame(rows)


def run(out_prefix: str, default_year: int = 2026, max_workers: int = 4):
    records = {}
    for param, value, label in FILTERS:
        total_pages, items = fetch_page(param, value, 1)
        for it in items:
            records.setdefault(it.get("acb200"), (label, it))
        pages = list(range(2, total_pages + 1))
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futs = {ex.submit(fetch_page, param, value, p): p for p in pages}
            for fut in as_completed(futs):
                _, items = fut.result()
                for it in items:
                    records.setdefault(it.get("acb200"), (label, it))
        print(f"{param}={value} ({label}) pages={total_pages} cumulative unique={len(records)}")

    print(f"Total unique jobs: {len(records)}")
    df = transform(list(records.values()), default_year)
    if df.empty:
        print("no data")
        return
    print("Year distribution:", df["year"].value_counts().to_dict())
    n = export_csv_sql(df, out_prefix, default_year=default_year)
    print(f"exported {n} unique records -> {out_prefix}.csv/.sql")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "exports", "mohrss_ggzp"))
    parser.add_argument("--default-year", type=int, default=2026)
    args = parser.parse_args()
    run(args.out, default_year=args.default_year)
