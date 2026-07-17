import os
import re
import time
import requests
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from database import Base
from models import Position
from ingest import ingest_positions_df
import pandas as pd

API_URL = "https://gp-api.iguopin.com/api/jobs/v1/list"
HEADERS = {
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json, text/plain, */*",
    "Device": "pc",
    "Subsite": "cujiuye",
    "Version": "5.0.0",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

KEYWORDS = [
    "", "2027", "2027届", "2026届", "2027校招", "2027秋招",
    "央企", "国企", "银行", "电力", "通信", "提前批",
]


def fetch_keyword(keyword: str, max_page=30):
    items = {}
    for page in range(1, max_page + 1):
        data = {
            "page": page,
            "page_size": 200,
            "keyword": keyword,
            "nature": ["115xW5oQ"],
        }
        r = requests.post(API_URL, json=data, headers=HEADERS, timeout=60)
        r.raise_for_status()
        res = r.json()
        if res.get("code") != 200:
            break
        for item in res["data"].get("list") or []:
            items[item["job_id"]] = item
        if len(res["data"].get("list") or []) < 200:
            break
        time.sleep(0.2)
    return list(items.values())


def determine_year(item):
    text = f"{item.get('job_name', '')}\n{item.get('contents', '')}"
    # Check explicit 2027/2026届 markers
    if re.search(r"2027\s*届|2027届|2027年应届|2027毕业生", text):
        return 2027
    if re.search(r"2026\s*届|2026届|2026年应届|2026毕业生", text):
        return 2026
    # Fallback: campus jobs posted in 2026 are mostly for 2027届
    return 2027


def location_from(district_list):
    parts = []
    for d in district_list or []:
        area = d.get("area_cn") or ""
        if area:
            parts.append(area)
    return "、".join(parts) if parts else "详见公告"


def major_from(item):
    majors = item.get("major_cn") or []
    return "、".join(majors) if majors else ""


def extract_special(item):
    lines = []
    lines.append(f"经验要求：{item.get('experience_cn', '')}")
    company_info = item.get("company_info") or {}
    lines.append(f"公司性质：{company_info.get('nature_cn', '')}")
    lines.append(f"公司规模：{company_info.get('scale_cn', '')}")
    lines.append(f"招聘人数：{item.get('amount', '')}")
    tags = item.get("job_tags_cn") or []
    if tags:
        lines.append(f"岗位标签：{', '.join(tags)}")
    proc = item.get("recruitment_process") or []
    if proc:
        lines.append(f"招聘流程：{', '.join(proc)}")
    contents = item.get("contents") or ""
    if contents:
        lines.append(contents)
    return "\n".join(lines).strip()


def transform(items):
    rows = []
    for item in items:
        loc = location_from(item.get("district_list") or [])
        major = major_from(item)
        special = extract_special(item)
        edu = item.get("education_cn") or ""
        company_nature = (item.get("company_info") or {}).get("nature_cn") or "央企/国企"
        job_type = "央企/国企" if company_nature in ("国企", "央企", "中央企业") else company_nature
        year = determine_year(item)
        start = item.get("start_time") or ""
        end = item.get("end_time") or ""
        signup = f"{start} 至 {end}" if start and end else (start or end)
        job_id = item.get("job_id") or ""
        source_url = f"https://www.iguopin.com/job/detail?id={job_id}"
        position_example = item.get("job_name") or ""
        category = item.get("category_cn") or ""
        if category and category not in position_example:
            position_example += f"；{category}"
        rows.append({
            "year": year,
            "工作类型": job_type,
            "考试/招聘类型": f"{year}{company_nature}校园招聘",
            "用人单位/系统": item.get("company_name") or "",
            "岗位示例": position_example,
            "学历要求": edu,
            "本科生专业要求": major,
            "研究生专业要求": major,
            "考试/招聘形式": "网申/简历筛选/笔试/面试（具体以企业公告为准）",
            "报名时间": signup,
            "笔试/考试时间": "",
            "特殊要求": special,
            "工作地点": loc,
            "信息来源": source_url,
            "备注": f"标签：{', '.join(item.get('job_tags_cn') or [])}",
            "专业要求（原始）": major,
        })
    return rows


def run():
    engine = create_engine(os.getenv("DATABASE_URL", "postgresql://recruit:recruit@localhost:5432/recruit"))
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Remove previous 国聘 imports (both 2026 and 2027 if any) to avoid duplicates
    db.execute(text(
        "DELETE FROM positions WHERE source_url LIKE 'https://www.iguopin.com/job/detail%'"
    ))
    db.commit()

    all_items = {}
    for kw in KEYWORDS:
        items = fetch_keyword(kw)
        print(f"Keyword '{kw}' fetched {len(items)} unique items")
        for item in items:
            all_items[item["job_id"]] = item

    print(f"Total unique jobs from guopin: {len(all_items)}")
    rows = transform(list(all_items.values()))
    df = pd.DataFrame(rows)
    print("DataFrame shape:", df.shape)
    print("Year distribution:", df["year"].value_counts().to_dict())

    ingest_positions_df(db, df)
    db.commit()
    print("Inserted guopin positions. Total in DB:", db.query(Position).count())
    db.close()


if __name__ == "__main__":
    run()
