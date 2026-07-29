"""下载并解析华图国考职位表 xls (u3.huatu.com/huatuzb/zwk/<year>gkzwb.xls)，导出 CSV/SQL。

字段比 xduim 国考库更全（职位简介/其它条件/落户地点等），可作为交叉补充来源。

用法:
    python import_huatu_gkzwb.py --years 2025 2026 --out ../exports/huatu_gk
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import requests
from export_utils import export_csv_sql

XLS_URL = "https://u3.huatu.com/huatuzb/zwk/{year}gkzwb.xls"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def _clean(val):
    if pd.isna(val) or val is None:
        return ""
    s = str(val).strip()
    return s if s.lower() not in ("nan", "none", "—", "-", "无") else ""


def download(year: int, dest_dir: str) -> str:
    path = os.path.join(dest_dir, f"{year}gkzwb.xls")
    if os.path.exists(path) and os.path.getsize(path) > 1024 * 100:
        return path
    url = XLS_URL.format(year=year)
    r = requests.get(url, headers=HEADERS, timeout=300)
    r.raise_for_status()
    os.makedirs(dest_dir, exist_ok=True)
    with open(path, "wb") as f:
        f.write(r.content)
    print(f"downloaded {url} -> {path} ({len(r.content)} bytes)")
    return path


def load_xls(path: str) -> pd.DataFrame:
    xls = pd.ExcelFile(path)
    frames = []
    for sheet in xls.sheet_names:
        df = pd.read_excel(xls, sheet_name=sheet, dtype=str)
        if df.empty:
            continue
        # first row repeats Chinese labels; drop it if it looks like a header
        first = df.iloc[0].astype(str)
        if "部门名称" in first.values:
            df = df.iloc[1:]
        frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def _split_major(text: str):
    if not text:
        return "", ""
    s = str(text)
    if "研究生" in s:
        parts = s.split("研究生", 1)
        u = parts[0].replace("本科：", "").replace("本科:", "").strip(" ，；;：:")
        g = parts[1].strip(" ，；;：:")
        return u, g
    return s, ""


def transform(df: pd.DataFrame, year: int) -> pd.DataFrame:
    rows = []
    for _, r in df.iterrows():
        code = _clean(r.get("zwk_zwdm"))
        dept = _clean(r.get("zwk_bmmc"))
        bureau = _clean(r.get("zwk_yrsj"))
        title = _clean(r.get("zwk_zwmj"))
        employer = f"{dept} {bureau}".strip()
        position_example = " ".join(p for p in [code, employer, title] if p)
        edu = _clean(r.get("zwk_xl"))
        major = _clean(r.get("zwk_zy"))
        u_major, g_major = _split_major(major)
        work_loc = _clean(r.get("zwk_gzdd")) or _clean(r.get("zwk_dd"))

        spec_items = []
        for col, label in [
            ("zwk_kslb", "考试类别"), ("zwk_zzmm", "政治面貌"), ("zwk_jcnx", "基层最低工作年限"),
            ("zwk_gzjl", "工作经历"), ("zwk_xw", "学位"), ("zwk_qitj", "其它条件"),
            ("zwk_zkrs", "招考人数"), ("zwk_xitong", "系统"), ("zwk_lhdd", "落户地点"),
        ]:
            v = _clean(r.get(col))
            if v:
                spec_items.append(f"{label}：{v}")

        notes = "；".join(x for x in [_clean(r.get("zwk_zwjj")), _clean(r.get("zwk_bz"))] if x)

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
            "信息来源": XLS_URL.format(year=year),
            "备注": notes,
            "专业要求（原始）": f"专业：{major}" if major else "",
        })
    out = pd.DataFrame(rows)
    out = out[out["岗位示例"].str.len() > 0]
    return out.drop_duplicates()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=int, nargs="+", default=[2025, 2026])
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "exports", "huatu_gk"))
    parser.add_argument("--cache", default="/tmp/huatu_xls")
    args = parser.parse_args()
    for year in args.years:
        print(f"=== huatu gkzwb {year} ===")
        try:
            path = download(year, args.cache)
        except Exception as exc:
            print(f"[warn] download {year}: {exc}")
            continue
        raw = load_xls(path)
        print(f"{year} raw rows: {len(raw)}")
        df = transform(raw, year)
        print(f"{year} transformed rows: {len(df)}")
        if not df.empty:
            n = export_csv_sql(df, f"{args.out}_{year}", default_year=year)
            print(f"exported {n} unique records -> {args.out}_{year}.csv/.sql")
