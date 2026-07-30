"""2027 公告期可配置抓取模板：监测 国考/军队文职/各省省考 官方公告页，
发现职位表附件（xls/xlsx/zip）即下载并尽力解析导出 CSV/SQL。

设计目标：公告未发布时安全空转（打印 not published yet），公告发布后
只需（必要时）修正 WATCHES 配置中的 index_url/keywords 即可开抓。

每个 watch 配置:
    name:        导出文件前缀
    index_urls:  公告索引页列表（依次尝试，容错 404/超时）
    keywords:    公告标题必须包含的关键词（全部满足）
    attach_exts: 附件扩展名
    year/job_type/exam_type: 解析成功后写入的标注

用法:
    python watch_2027_announcements.py                 # 监测全部
    python watch_2027_announcements.py --only guokao_2027
    python watch_2027_announcements.py --list          # 查看配置与可达性
"""
import argparse
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import requests
from export_utils import export_csv_sql

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
}

WATCHES = [
    {
        "name": "guokao_2027",
        # 国家公务员局考录专题：kl{year} 为历年专题路径（kl2026 已存在，kl2027 待发布）
        "index_urls": [
            "http://bm.scs.gov.cn/kl2027",
            "https://www.scs.gov.cn/",
        ],
        "keywords": ["2027", "职位"],
        "attach_exts": [".xls", ".xlsx", ".zip"],
        "year": 2027,
        "job_type": "公务员",
        "exam_type": "2027国家公务员考试",
    },
    {
        "name": "junwenzhi_2027",
        # 军队人才网文职人员专区；职位系统 211.166.6.67:9001 公告期才开放
        "index_urls": [
            "http://81rc.81.cn/wzry/index.html",
            "http://81rc.81.cn/",
        ],
        "keywords": ["2027", "文职"],
        "attach_exts": [".xls", ".xlsx", ".zip"],
        "year": 2027,
        "job_type": "军队文职",
        "exam_type": "2027军队文职人员招考",
    },
]

# 各省人事考试网 2027 省考监测（多数从当前环境不可达，公告期建议换网络/代理运行）
PROVINCE_SITES = {
    "河北": "https://www.hebpta.com.cn/",
    "辽宁": "https://www.lnrsks.com/",
    "吉林": "http://www.jlzkb.com/",
    "黑龙江": "https://www.hljrsks.org.cn/",
    "四川": "https://www.scpta.com.cn/",
    "甘肃": "http://rst.gansu.gov.cn/",
    "青海": "https://www.qhpta.com/",
    "西藏": "http://hrss.xizang.gov.cn/",
    "内蒙古": "https://www.impta.com.cn/",
}
for prov, url in PROVINCE_SITES.items():
    WATCHES.append({
        "name": f"shengkao_2027_{prov}",
        "index_urls": [url],
        "keywords": ["2027", "职位"],
        "attach_exts": [".xls", ".xlsx", ".zip"],
        "year": 2027,
        "job_type": "公务员",
        "exam_type": f"2027{prov}公务员考试",
    })

# 职位表常见列名 -> 规范字段（尽力映射，未识别列并入特殊要求）
COLMAP = {
    "用人单位/系统": ["招录机关", "招考单位", "用人单位", "部门名称", "单位名称", "招聘单位"],
    "岗位示例": ["职位名称", "岗位名称", "招考职位"],
    "学历要求": ["学历", "学历要求", "最低学历"],
    "本科生专业要求": ["专业", "专业要求", "所学专业"],
    "工作地点": ["工作地点", "职位所在地", "工作地区"],
    "特殊要求": ["备注", "其他条件", "其它条件"],
}


def _get(url, retries=3, timeout=30, binary=False):
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=timeout)
            r.raise_for_status()
            if not binary:
                r.encoding = r.apparent_encoding or "utf-8"
            return r.content if binary else r.text
        except Exception as exc:
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            print(f"  [warn] GET {url}: {exc}")
            return None


def find_announcements(index_url: str, keywords):
    html = _get(index_url)
    if html is None:
        return []
    links = []
    for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, re.S):
        href, text = m.group(1), re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if all(k in text for k in keywords):
            links.append((urllib.parse.urljoin(index_url, href), text))
    return links


def find_attachments(page_url: str, exts):
    html = _get(page_url)
    if html is None:
        return []
    out = []
    for m in re.finditer(r'href="([^"]+)"', html):
        href = m.group(1)
        if any(href.lower().split("?")[0].endswith(e) for e in exts):
            out.append(urllib.parse.urljoin(page_url, href))
    return out


def parse_position_table(path: str, watch) -> pd.DataFrame:
    """尽力把职位表 xls/xlsx 解析为规范 DataFrame；失败返回空表。"""
    try:
        sheets = pd.read_excel(path, sheet_name=None, header=None)
    except Exception as exc:
        print(f"  [warn] cannot parse {path}: {exc}")
        return pd.DataFrame()
    rows = []
    for _, raw in sheets.items():
        header_idx = None
        for i in range(min(10, len(raw))):
            vals = [str(v) for v in raw.iloc[i].tolist()]
            if any(any(c in v for c in ("职位", "岗位")) for v in vals):
                header_idx = i
                break
        if header_idx is None:
            continue
        df = raw.iloc[header_idx + 1:].copy()
        df.columns = [str(c).strip() for c in raw.iloc[header_idx].tolist()]
        for _, r in df.iterrows():
            rec = {k: "" for k in COLMAP}
            extras = []
            for col in df.columns:
                v = str(r.get(col, "")).strip()
                if not v or v.lower() in ("nan", "none"):
                    continue
                mapped = False
                for field, aliases in COLMAP.items():
                    if any(a in col for a in aliases):
                        rec[field] = rec[field] or v
                        mapped = True
                        break
                if not mapped:
                    extras.append(f"{col}：{v}")
            if not rec["岗位示例"]:
                continue
            rows.append({
                "year": watch["year"],
                "工作类型": watch["job_type"],
                "考试/招聘类型": watch["exam_type"],
                "用人单位/系统": rec["用人单位/系统"],
                "岗位示例": f"{rec['用人单位/系统']} {rec['岗位示例']}".strip(),
                "学历要求": rec["学历要求"],
                "本科生专业要求": rec["本科生专业要求"],
                "研究生专业要求": "",
                "考试/招聘形式": "笔试+面试",
                "报名时间": "",
                "笔试/考试时间": "",
                "特殊要求": "；".join([rec["特殊要求"]] + extras[:20]).strip("；"),
                "工作地点": rec["工作地点"],
                "信息来源": watch["index_urls"][0],
                "备注": "",
                "专业要求（原始）": f"专业：{rec['本科生专业要求']}" if rec["本科生专业要求"] else "",
            })
    return pd.DataFrame(rows)


def run_watch(watch, out_dir: str):
    name = watch["name"]
    print(f"=== {name} ===")
    announcements = []
    for idx_url in watch["index_urls"]:
        announcements = find_announcements(idx_url, watch["keywords"])
        if announcements:
            break
    if not announcements:
        print("  not published yet (no matching announcements)")
        return 0
    total = 0
    dl_dir = os.path.join(out_dir, f"{name}_attachments")
    os.makedirs(dl_dir, exist_ok=True)
    for page_url, title in announcements[:20]:
        print(f"  announcement: {title} -> {page_url}")
        for att in find_attachments(page_url, watch["attach_exts"]):
            fname = os.path.join(dl_dir, os.path.basename(urllib.parse.urlparse(att).path))
            data = _get(att, binary=True)
            if data is None:
                continue
            with open(fname, "wb") as f:
                f.write(data)
            print(f"  downloaded {att} -> {fname}")
            if fname.lower().endswith((".xls", ".xlsx")):
                df = parse_position_table(fname, watch)
                if not df.empty:
                    n = export_csv_sql(df, os.path.join(out_dir, name))
                    print(f"  exported {n} records -> {name}.csv/.sql")
                    total += n
                else:
                    print(f"  [info] saved raw attachment only (columns not recognized): {fname}")
    return total


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", help="只运行指定 watch 名称")
    parser.add_argument("--list", action="store_true", help="列出配置并测试索引页可达性")
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "exports"))
    args = parser.parse_args()

    watches = [w for w in WATCHES if not args.only or w["name"] in args.only]
    if args.list:
        for w in watches:
            for u in w["index_urls"]:
                try:
                    code = requests.get(u, headers=HEADERS, timeout=15).status_code
                except Exception:
                    code = "unreachable"
                print(f"{w['name']}: {u} -> {code}")
        sys.exit(0)
    for w in watches:
        run_watch(w, args.out)
