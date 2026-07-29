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

PROVINCE_MAP = {
    "beijing": "北京",
    "chongqing": "重庆",
    "fujian": "福建",
    "guangdong": "广东",
    "guangxi": "广西",
    "guizhou": "贵州",
    "hainan": "海南",
    "henan": "河南",
    "hubei": "湖北",
    "hunan": "湖南",
    "jiangsu": "江苏",
    "jiangxi": "江西",
    "ningxia": "宁夏",
    "shandong": "山东",
    "shanghai": "上海",
    "shanxi": "山西",
    "shanxixi": "陕西",
    "tianjin": "天津",
    "xinjiang": "新疆",
    "yunnan": "云南",
    "zhejiang": "浙江",
}


def get_cities(province_pinyin: str):
    url = f"{BASE}/zw/{province_pinyin}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.encoding = "utf-8"
        links = re.findall(rf"/zw/{province_pinyin}/gwylist\?year=(\d{{4}})&city=([^\"'<>\\s]+)", r.text)
        years_cities = {}
        for year, city in links:
            years_cities.setdefault(int(year), []).append(urllib.parse.unquote(city))
        return {y: sorted(set(c)) for y, c in years_cities.items()}
    except Exception as exc:
        print(f"[warn] get_cities {province_pinyin}: {exc}")
        return {}


def _read_html(html: str):
    """Try lxml first; fall back to html5lib."""
    try:
        dfs = pd.read_html(StringIO(html))
        return dfs[0] if dfs else pd.DataFrame()
    except Exception:
        try:
            dfs = pd.read_html(StringIO(html), flavor="html5lib")
            return dfs[0] if dfs else pd.DataFrame()
        except Exception:
            return pd.DataFrame()


def fetch_page(province_pinyin: str, city: str, year: int, page: int, retries: int = 3):
    city_q = urllib.parse.quote(city)
    url = f"{BASE}/zw/{province_pinyin}/gwylist?year={year}&city={city_q}&curPage={page}"
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
            print(f"[warn] fetch {province_pinyin}/{city}/{year} page {page}: {exc}")
            return 1, pd.DataFrame()


_COLUMN_BLACKLIST = {"详情", "对比", "职位详情", "职位对比", "岗位详情", "岗位对比", "操作"}

_COLUMN_PATTERNS = {
    "code": ["职位代码", "岗位代码", "职位编号", "序号"],
    "region": ["地区", "城市", "区县", "所属地区", "工作地点", "工作地", "地区名称"],
    "employer": ["单位名称", "用人单位", "招录机关", "招考机关", "招考部门", "机构名称", "招录单位", "用人单位名称"],
    "title": ["招聘职位", "职位名称", "岗位名称", "部门及职位", "岗位"],
    "position_type": ["职位类型", "职位类别", "岗位类别", "职位性质"],
    "edu": ["学历", "学历要求", "学历学位", "学位学历", "文化程度"],
    "u_major": ["本科专业", "本科专业要求", "本科"],
    "g_major": ["研究生专业", "硕士研究生专业", "研究生专业要求", "研究生"],
    "d_major": ["大专专业", "专科专业", "高职专业", "大专", "专科"],
    "major": ["专业", "专业要求", "专业及学历要求", "所学专业"],
    "amount": ["招聘人数", "招录人数", "招考人数", "计划人数", "名额", "招录名额"],
    "political": ["政治面貌", "政治面貌要求", "政治"],
    "experience": ["基层工作经历", "基层工作经验", "工作经历", "基层工作年限"],
    "recruit_target": ["招考对象", "应届", "招考对象/身份", "对象", "考生身份"],
    "gender": ["性别", "性别要求"],
    "org_nature": ["机构性质", "单位性质", "机构类别"],
    "unit_code": ["单位代码", "部门代码", "机构代码"],
    "recruit_org": ["招录机关", "招录机关名称", "招考机关"],
}


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    mapping = {}
    used = set()
    for col in df.columns:
        col_clean = str(col).strip().replace(" ", "").replace("\n", "")
        if col_clean in _COLUMN_BLACKLIST:
            mapping[col] = col  # keep original but do not map
            continue
        assigned = None
        for key, patterns in _COLUMN_PATTERNS.items():
            if key in used:
                continue
            for pat in patterns:
                if col_clean == pat:
                    assigned = key
                    break
            if assigned:
                break
        if assigned:
            mapping[col] = assigned
            used.add(assigned)
        else:
            mapping[col] = col
    return df.rename(columns=mapping)


def _split_major(text: str, edu: str = ""):
    """Parse a combined 专业 column into undergrad/grad/专科 strings."""
    if not text:
        return "", "", ""
    s = str(text).strip()
    # Match label only when it is a real category header:
    # at start of string or after a separator, and followed by a separator (: or space)
    label_re = re.compile(r"(?:^|[；;，,、（）()\s])(本科|研究生|硕士|博士|大专|专科|高职)(?:[:：\s]+)")
    matches = list(label_re.finditer(s))
    if not matches:
        # No labels: infer from education string
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
        # content is from end of this match to start of next match (or end of string)
        end_pos = m.end()
        next_start = matches[i + 1].start() if i + 1 < len(matches) else len(s)
        part = s[end_pos:next_start].strip(" ，；;")
        # aggregate if a key appears multiple times (take first non-empty)
        if key not in parts or not parts[key]:
            parts[key] = part
    return parts.get("本科", ""), parts.get("研究生", ""), parts.get("大专", "")


def transform(df: pd.DataFrame, province_name: str, province_pinyin: str, year: int) -> pd.DataFrame:
    if df.empty:
        return df
    df = _normalize_columns(df)
    rows = []
    for _, r in df.iterrows():
        code = _clean(r.get("code"))
        title = _clean(r.get("title"))
        position_example = f"{code} {title}".strip() if code else (title or "")
        employer = _clean(r.get("employer") or r.get("recruit_org"))
        region = _clean(r.get("region"))
        work_loc = f"{province_name} {region}".strip() if region else province_name
        edu = _clean(r.get("edu"))

        # major handling
        u_major = _clean(r.get("u_major"))
        g_major = _clean(r.get("g_major"))
        d_major = _clean(r.get("d_major"))
        if (not u_major and not g_major and not d_major) or (r.get("major") and not (u_major or g_major or d_major)):
            u2, g2, d2 = _split_major(r.get("major"), edu or "")
            u_major = u_major or u2
            g_major = g_major or g2
            d_major = d_major or d2

        raw_major = ""
        if u_major:
            raw_major += f"本科：{u_major}"
        if g_major:
            raw_major += ("；" if raw_major else "") + f"研究生：{g_major}"
        if d_major:
            raw_major += ("；" if raw_major else "") + f"大专：{d_major}"
        if not raw_major and r.get("major"):
            raw_major = f"专业：{_clean(r.get('major'))}"

        spec_items = []
        if r.get("position_type"):
            spec_items.append(f"职位类型：{r['position_type']}")
        if r.get("political"):
            spec_items.append(f"政治面貌：{r['political']}")
        if r.get("experience"):
            spec_items.append(f"基层工作经历：{r['experience']}")
        if r.get("recruit_target"):
            spec_items.append(f"招考对象：{r['recruit_target']}")
        if r.get("gender"):
            spec_items.append(f"性别：{r['gender']}")
        if r.get("org_nature"):
            spec_items.append(f"机构性质：{r['org_nature']}")
        if r.get("amount"):
            spec_items.append(f"招聘人数：{r['amount']}")
        special = "；".join(spec_items)

        rows.append({
            "year": year,
            "工作类型": "公务员",
            "考试/招聘类型": f"{year}{province_name}公务员考试",
            "用人单位/系统": employer,
            "岗位示例": position_example,
            "学历要求": edu,
            "本科生专业要求": u_major,
            "研究生专业要求": g_major,
            "考试/招聘形式": "笔试+面试",
            "报名时间": "",
            "笔试/考试时间": "",
            "特殊要求": special,
            "工作地点": work_loc,
            "信息来源": f"{BASE}/zw/{province_pinyin}",
            "备注": f"大专专业：{d_major}" if d_major else "",
            "专业要求（原始）": raw_major,
        })
    return pd.DataFrame(rows)


def _clean(val):
    if pd.isna(val) or val is None:
        return ""
    s = str(val).strip()
    return s if s.lower() not in ("nan", "none", "—", "-") else ""


def scrape_year(year: int, max_workers: int = 6):
    # collect (pinyin, name, city, page=1) seeds
    seeds = []
    for pinyin, name in PROVINCE_MAP.items():
        years_cities = get_cities(pinyin)
        cities = years_cities.get(year, [])
        if not cities:
            print(f"[skip] {name} {year} no cities")
            continue
        print(f"[start] {name} {year} cities={len(cities)}")
        for city in cities:
            seeds.append((pinyin, name, city, 1))

    if not seeds:
        return pd.DataFrame()

    all_dfs = []
    lock = {"count": 0, "page_count": 0}
    pending = list(seeds)

    def worker(pinyin, name, city, page):
        total_pages, df = fetch_page(pinyin, city, year, page)
        lock["page_count"] += 1
        if lock["page_count"] % 100 == 0:
            print(f"[progress] {year} pages={lock['page_count']} in-flight={len(pending)} chunks={len(all_dfs)}")
        if page == 1 and total_pages > 1:
            for p in range(2, total_pages + 1):
                pending.append((pinyin, name, city, p))
        if not df.empty:
            all_dfs.append((pinyin, name, df))

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}

        def submit_up_to(limit=60):
            while pending and len(futures) < limit:
                pinyin, name, city, page = pending.pop(0)
                fut = executor.submit(worker, pinyin, name, city, page)
                futures[fut] = True

        submit_up_to()
        while futures:
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception as exc:
                    print(f"[warn] worker error: {exc}")
                futures.pop(fut, None)
                submit_up_to()
                break

    print(f"[scrape {year}] total pages={lock['page_count']} raw chunks={len(all_dfs)}")
    if not all_dfs:
        return pd.DataFrame()

    transformed = []
    for pinyin, name, df in all_dfs:
        transformed.append(transform(df, name, pinyin, year))
    df = pd.concat(transformed, ignore_index=True)
    # drop rows where we couldn't extract anything useful
    df = df[df["岗位示例"].str.len() > 0]
    return df


if __name__ == "__main__":
    years = [int(x) for x in sys.argv[1:]] if len(sys.argv) > 1 else [2026]
    db = SessionLocal()
    try:
        for year in years:
            print(f"=== scraping {year} shengkao from xduim.com ===")
            df = scrape_year(year)
            print(f"{year} rows: {len(df)}")
            if not df.empty:
                ingest_positions_df(db, df)
                db.commit()
                print(f"ingested {year}; total positions: {db.query(Position).count()}")
    finally:
        db.close()
