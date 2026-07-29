"""抓取 zw.zgsydw.com 事业单位职位（如 2027 提前批/人才引进），导出 CSV/SQL（不写库）。

复用 scrape_zw_zgsydw 的会话/分页/转换逻辑，仅把入库替换为文件导出。

用法:
    python scrape_zgsydw_export.py --years 2027 --out ../exports/sydw_2027
"""
import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
from export_utils import export_csv_sql
from scrape_zw_zgsydw import (
    _fetch_query_records,
    _get_provinces_and_cities,
    _get_session,
    _plan_queries,
)


def scrape_to_df(years, max_concurrent=8, selected_provinces=None, max_pages_per_query=None):
    sel_set = set(selected_provinces) if selected_provinces else None
    session, token = _get_session()
    province_id_to_name, province_name_to_cities = _get_provinces_and_cities(session, token, years[0])
    plans = _plan_queries(session, token, province_id_to_name, province_name_to_cities, years, sel_set)
    print("计划查询数:", len(plans))

    all_records = {}
    with ThreadPoolExecutor(max_workers=max_concurrent) as executor:
        for idx, (prov, year, edu, city, total) in enumerate(plans, 1):
            records = _fetch_query_records(executor, prov, year, edu, city, total, max_pages_per_query)
            for rec in records:
                all_records[rec.get("信息来源") or id(rec)] = rec
            print(f"[{idx}/{len(plans)}] {prov} {year} edu={edu or 'all'} city={city or 'all'} -> {len(records)} 条，累计 {len(all_records)} 条")
    return pd.DataFrame(list(all_records.values()))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=int, nargs="+", default=[2027])
    parser.add_argument("--provinces", type=str, nargs="*", default=None)
    parser.add_argument("--max-concurrent", type=int, default=8)
    parser.add_argument("--max-pages-per-query", type=int, default=None)
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "exports", "sydw"))
    args = parser.parse_args()
    df = scrape_to_df(args.years, args.max_concurrent, args.provinces, args.max_pages_per_query)
    print("rows:", len(df))
    if not df.empty:
        suffix = "_".join(str(y) for y in args.years)
        n = export_csv_sql(df, f"{args.out}_{suffix}", default_year=args.years[0])
        print(f"exported {n} unique records -> {args.out}_{suffix}.csv/.sql")
