"""导入编制类招聘公告 CSV（data/bianzhi/*.csv）到 bianzhi_jobs 表。

用法：python import_bianzhi.py [csv目录]
按 content_hash 幂等去重，可重复运行。
"""
import csv
import hashlib
import os
import sys

from sqlalchemy import text

from database import Base, SessionLocal, engine
from models import BianzhiJob

csv.field_size_limit(10 * 1024 * 1024)

# 文件名前缀 -> (category, 列名映射)
TABLE_SPECS = {
    "公务员事业单位": {
        "employer": "招聘单位", "headcount": "招聘人数", "deadline_text": "截止时间",
        "edu_requirement": "学历要求", "job_type": "类型", "province": "省份",
        "work_location": "工作地", "announce_url": "公告链接", "updated_at_src": "更新时间",
    },
    "教育系统": {
        "employer": "招聘单位", "headcount": "招聘人数", "deadline_text": "截止时间",
        "edu_requirement": "学历要求", "job_type": "类型", "province": "所属省份",
        "work_location": "工作地", "announce_url": "公告链接", "updated_at_src": "更新时间",
        "major_requirement": "需求学科",
    },
    "医疗系统": {
        "employer": "招聘单位", "headcount": "招聘人数", "deadline_text": "截止时间",
        "edu_requirement": "学历要求", "job_type": "类型", "province": "所属省份",
        "work_location": "工作地", "announce_url": "公告链接", "updated_at_src": "更新时间",
        "major_requirement": "招聘专业",
    },
    "高校高职大专": {
        "employer": "招聘单位", "headcount": "招聘人数", "deadline_text": "截止时间",
        "edu_requirement": "学历要求", "job_type": "类型", "province": "所属省份",
        "work_location": "工作地", "announce_url": "公告链接", "updated_at_src": "更新时间",
        "major_requirement": "招聘专业",
    },
    "科研院所": {
        "employer": "招聘单位", "headcount": "招聘人数", "deadline_text": "截止时间",
        "edu_requirement": "学历要求", "job_type": "类型", "province": "所属省份",
        "work_location": "工作地", "announce_url": "公告链接", "updated_at_src": "更新时间",
        "major_requirement": "招聘专业",
    },
    "央国企社招": {
        "employer": "招聘公告标题", "job_type": "企业类型", "province": "省份/直辖市",
        "work_location": "城市/区域", "edu_requirement": "学历要求",
        "major_requirement": "参考专业", "apply_url": "招聘网址",
        "updated_at_src": "录入日期",
    },
    "26年大型联考汇总": {
        "province": "省份", "job_type": "招考类型", "headcount": "招录人数",
        "edu_requirement": "学历要求", "signup_start": "报名开始时间",
        "exam_time": "考试时间", "announce_url": "招聘公告链接",
        "notes": "备注 (1)", "updated_at_src": "发布日期",
    },
}

CATEGORY_NAMES = {"26年大型联考汇总": "大型联考"}


def norm(v: str) -> str:
    return (v or "").strip()


def row_hash(category: str, d: dict) -> str:
    key = "|".join([category, d.get("employer", ""), d.get("province", ""),
                    d.get("announce_url", ""), d.get("apply_url", ""),
                    d.get("deadline_text", ""), d.get("exam_time", "")])
    return hashlib.md5(key.encode("utf-8")).hexdigest()


LIMITS = {"category": 50, "province": 50, "headcount": 200, "job_type": 200,
          "work_location": 500, "edu_requirement": 200, "deadline_text": 300,
          "signup_start": 50, "exam_time": 50, "updated_at_src": 30}


def import_file(db, path: str, category: str, colmap: dict) -> tuple[int, int]:
    added, skipped = 0, 0
    existing = {h for (h,) in db.execute(text("SELECT content_hash FROM bianzhi_jobs"))}
    with open(path, newline="", encoding="utf-8") as fp:
        for row in csv.DictReader(fp):
            d = {field: norm(row.get(col, "")) for field, col in colmap.items()}
            if not d.get("employer") and not d.get("province"):
                skipped += 1
                continue
            h = row_hash(category, d)
            if h in existing:
                skipped += 1
                continue
            existing.add(h)
            for k, lim in LIMITS.items():
                if k in d and d[k]:
                    d[k] = d[k][:lim]
            db.add(BianzhiJob(category=category, content_hash=h, **d))
            added += 1
    db.commit()
    return added, skipped


def main():
    base_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "data", "bianzhi")
    Base.metadata.create_all(bind=engine, tables=[BianzhiJob.__table__])
    db = SessionLocal()
    try:
        for fname in sorted(os.listdir(base_dir)):
            if not fname.endswith(".csv"):
                continue
            spec = next(((st, m) for st, m in TABLE_SPECS.items() if fname.startswith(st)), None)
            if not spec:
                print("skip (no spec):", fname)
                continue
            st, colmap = spec
            category = CATEGORY_NAMES.get(st, st)
            added, skipped = import_file(db, os.path.join(base_dir, fname), category, colmap)
            print(f"{fname}: +{added} (skip {skipped})")
        total = db.query(BianzhiJob).count()
        print("bianzhi_jobs total:", total)
    finally:
        db.close()


if __name__ == "__main__":
    main()
