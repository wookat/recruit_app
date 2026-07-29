import os
import re
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import StringIO

sys.path.insert(0, "/home/ubuntu")
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import requests
from database import SessionLocal
from ingest import ingest_positions_df
from models import Position

BASE = "https://www.xduim.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

ANHUI_CITIES = [
    "省直", "合肥", "芜湖", "蚌埠", "淮南", "马鞍山", "淮北", "铜陵",
    "安庆", "黄山", "滁州", "阜阳", "宿州", "六安", "亳州", "池州", "宣城",
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


def fetch_city_page(city: str, year: int, page: int, retries: int = 3):
    city_q = urllib.parse.quote(city)
    url = f"{BASE}/zw/gwy/list?city={city_q}&year={year}&curPage={page}"
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            r.encoding = "utf-8"
            m = re.search(r'value="(\d+)/(\d+)"', r.text)
            total_pages = int(m.group(2)) if m else 1
            df = _read_html(r.text)
            return total_pages, df
        except Exception as exc:
            if attempt < retries:
                time.sleep(1.0 * (attempt + 1))
                continue
            print(f"[warn] fetch anhui/{city}/{year} page {page}: {exc}")
            return 1, pd.DataFrame()


def _split_major(text: str, edu: str = ""):
    if not text:
        return "", "", ""
    s = str(text).strip()
    label_re = re.compile(r"(?:^|[；;，,、（）()\s])(本科|研究生|硕士|博士|大专|专科|高职)(?:[:：\s]+)")
    matches = list(label_re.finditer(s))
    if not matches:
        if "大专" in edu or "专科" in edu:
            return "", "", s
        if "研究生" in edu or "硕士" in edu or "博士" in edu:
            return "", s, ""
        if "本科" in edu:
            return s, "", ""
        return s, "", ""
    label_map = {"本科": "本科", "研究生": "研究生", "硕士": "研究生", "博士": "研究生",
                "大专": "大专", "专科": "大专", "高职": "大专"}
    parts = {}
    for i, m in enumerate(matches):
        key = label_map[m.group(1)]
        end_pos = m.end()
        next_start = matches[i + 1].start() if i + 1 < len(matches) else len(s)
        part = s[end_pos:next_start].strip(" ，；;")
        if key not in parts or not parts[key]:
            parts[key] = part
    return parts.get("本科", ""), parts.get("研究生", ""), parts.get("大专", "")


def transform(df: pd.DataFrame, year: int) -> pd.DataFrame:
    if df.empty:
        return df
    col_map = {
        "职位代码": "code",
        "地区": "region",
        "招聘单位": "employer",
        "专业": "major",
        "专业课": "subject",
        "学历/学位": "edu",
        "学历": "edu",
        "证书": "cert",
        "性别": "gender",
        "招聘人数": "amount",
        "报名人数": "applications",
        "分数线": "score_line",
        "最高分": "highest_score",
    }
    df = df.rename(columns={c: col_map.get(c.strip() if isinstance(c, str) else c, c) for c in df.columns})
    rows = []
    for _, r in df.iterrows():
        code = _clean(r.get("code"))
        region = _clean(r.get("region"))
        employer = _clean(r.get("employer"))
        title_parts = [p for p in [employer, region] if p]
        position_example = (code + " " + " ".join(title_parts)).strip() if code else " ".join(title_parts)
        edu_full = _clean(r.get("edu"))
        # keep only the first education segment
        edu = edu_full.split("学士")[0].split("硕士")[0].split("博士")[0] if edu_full else ""

        major = _clean(r.get("major"))
        u_major, g_major, d_major = _split_major(major, edu or "")

        raw_major = ""
        if u_major:
            raw_major += f"本科：{u_major}"
        if g_major:
            raw_major += ("；" if raw_major else "") + f"研究生：{g_major}"
        if d_major:
            raw_major += ("；" if raw_major else "") + f"大专：{d_major}"
        if not raw_major and major:
            raw_major = f"专业：{major}"

        spec_items = []
        if r.get("subject"):
            spec_items.append(f"专业课：{r['subject']}")
        if r.get("cert"):
            spec_items.append(f"证书：{r['cert']}")
        if r.get("gender"):
            spec_items.append(f"性别：{r['gender']}")
        if r.get("amount"):
            spec_items.append(f"招聘人数：{r['amount']}")
        if r.get("applications"):
            spec_items.append(f"报名人数：{r['applications']}")
        if r.get("score_line"):
            spec_items.append(f"分数线：{r['score_line']}")
        if r.get("highest_score"):
            spec_items.append(f"最高分：{r['highest_score']}")
        special = "；".join(spec_items)

        rows.append({
            "year": year,
            "工作类型": "公务员",
            "考试/招聘类型": f"{year}安徽省公务员考试",
            "用人单位/系统": employer,
            "岗位示例": position_example,
            "学历要求": edu,
            "本科生专业要求": u_major,
            "研究生专业要求": g_major,
            "考试/招聘形式": "笔试+面试",
            "报名时间": "",
            "笔试/考试时间": "",
            "特殊要求": special,
            "工作地点": f"安徽 {region}".strip(),
            "信息来源": f"{BASE}/zw/gwy/list",
            "备注": f"大专专业：{d_major}" if d_major else "",
            "专业要求（原始）": raw_major,
        })
    return pd.DataFrame(rows)


def scrape_year(year: int, max_workers: int = 2):
    all_dfs = []
    pending = []
    for city in ANHUI_CITIES:
        pending.append((city, 1))

    lock = {"pages": 0, "chunks": 0}

    def worker(city, page):
        total_pages, df = fetch_city_page(city, year, page)
        lock["pages"] += 1
        if lock["pages"] % 50 == 0:
            print(f"[anhui {year}] pages={lock['pages']} pending={len(pending)} chunks={lock['chunks']}")
        if page == 1 and total_pages > 1:
            for p in range(2, total_pages + 1):
                pending.append((city, p))
        if not df.empty:
            all_dfs.append(df)
            lock["chunks"] += 1

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}

        def submit_up_to(limit=20):
            while pending and len(futures) < limit:
                city, page = pending.pop(0)
                fut = executor.submit(worker, city, page)
                futures[fut] = True

        submit_up_to()
        while futures:
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception as exc:
                    print(f"[warn] anhui worker error: {exc}")
                futures.pop(fut, None)
                submit_up_to()
                break

    print(f"[anhui {year}] total pages={lock['pages']} chunks={lock['chunks']}")
    if not all_dfs:
        return pd.DataFrame()
    df = pd.concat([transform(d, year) for d in all_dfs], ignore_index=True)
    df = df[df["岗位示例"].str.len() > 0]
    return df


if __name__ == "__main__":
    years = [int(x) for x in sys.argv[1:]] if len(sys.argv) > 1 else [2026]
    db = SessionLocal()
    try:
        for year in years:
            print(f"=== scraping anhui {year} shengkao ===")
            df = scrape_year(year)
            print(f"{year} rows: {len(df)}")
            if not df.empty:
                ingest_positions_df(db, df)
                db.commit()
                print(f"ingested {year}; total positions: {db.query(Position).count()}")
    finally:
        db.close()
