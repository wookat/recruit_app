"""扩展抓取国聘 (iguopin.com) 央企/国企校招职位，导出 CSV/SQL（不写库）。

在 import_guopin_2027 的基础上扩大关键词覆盖（主要央企集团名、行业词、
批次词），并同时抓取校招与社招两类 nature，按 job_id 去重。

用法:
    python scrape_iguopin_ext.py --out ../exports/iguopin_ext
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import requests
from export_utils import export_csv_sql
from import_guopin_2027 import API_URL, HEADERS, transform

NATURE_CAMPUS = "115xW5oQ"

KEYWORDS = [
    "", "2026届", "2027届", "2026校招", "2027校招", "2026秋招", "2027秋招",
    "2026春招", "2027春招", "提前批", "补录", "央企", "国企", "校园招聘",
    # 行业
    "银行", "证券", "保险", "电力", "电网", "能源", "通信", "运营商",
    "铁路", "机场", "航空", "港口", "军工", "航天", "核电", "石油", "烟草",
    # 主要央企集团
    "国家电网", "南方电网", "国家能源", "华能", "大唐", "华电", "国家电投",
    "三峡", "中核", "中广核", "航天科技", "航天科工", "中航工业", "中国船舶",
    "兵器工业", "兵器装备", "中国电科", "中国电子", "中石油", "中石化", "中海油",
    "中国移动", "中国电信", "中国联通", "中国铁塔", "国铁", "中国中车",
    "中国商飞", "东风汽车", "一汽", "中国宝武", "中铝", "五矿", "中国建筑",
    "中国中铁", "中国铁建", "中交", "中国电建", "中国能建", "中粮", "华润",
    "招商局", "中远海运", "国家开发银行", "进出口银行", "农业发展银行",
    "工商银行", "农业银行", "中国银行", "建设银行", "交通银行", "邮储银行",
]


def fetch_keyword(keyword: str, nature: str, max_page=50):
    items = {}
    stale = 0
    for page in range(1, max_page + 1):
        data = {"page": page, "page_size": 200, "keyword": keyword}
        if nature:
            data["nature"] = [nature]
        try:
            r = requests.post(API_URL, json=data, headers=HEADERS, timeout=60)
            r.raise_for_status()
            res = r.json()
        except Exception as exc:
            print(f"[warn] iguopin kw='{keyword}' page {page}: {exc}")
            time.sleep(1)
            continue
        if res.get("code") != 200:
            break
        batch = res["data"].get("list") or []
        prev = len(items)
        for item in batch:
            items[item["job_id"]] = item
        if len(batch) < 200:
            break
        if len(items) == prev:
            stale += 1
            if stale >= 3:
                break
        else:
            stale = 0
        time.sleep(0.2)
    return items


def run(out_prefix: str):
    all_items = {}
    for kw in KEYWORDS:
        items = fetch_keyword(kw, NATURE_CAMPUS)
        new = sum(1 for k in items if k not in all_items)
        all_items.update(items)
        print(f"kw='{kw}' fetched={len(items)} new={new} total={len(all_items)}")

    print(f"Total unique jobs: {len(all_items)}")
    rows = transform(list(all_items.values()))
    df = pd.DataFrame(rows)
    if df.empty:
        print("no data")
        return
    print("Year distribution:", df["year"].value_counts().to_dict())
    n = export_csv_sql(df, out_prefix, default_year=2027)
    print(f"exported {n} unique records -> {out_prefix}.csv/.sql")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "exports", "iguopin_ext"))
    args = parser.parse_args()
    run(args.out)
