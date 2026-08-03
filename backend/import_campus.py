"""导入校招/社招汇总 CSV（data/campus/*.csv）到 campus_jobs 表。

用法：python import_campus.py [csv目录]
按 content_hash（source_table+company+positions+apply_url+announce_url）幂等去重，可重复运行。
"""
import csv
import hashlib
import os
import re
import sys

from sqlalchemy import text

from data_clean import clean_major_requirement, clean_positions
from database import Base, SessionLocal, engine
from models import CampusJob

csv.field_size_limit(10 * 1024 * 1024)

# 文件名前缀 -> (source_table, 列名映射)
TABLE_SPECS = {
    "校招汇总表": {
        "company": "公司", "positions": "招聘岗位", "edu_requirement": "学历要求",
        "no_exam": "是否笔试", "major_requirement": "专业要求", "notes": "备注",
        "locations": "工作地点", "grad_years": "招聘届次", "updated_at_src": "更新时间",
        "company_type": "企业类型", "start_date": "开始时间", "industry": "行业类别",
        "deadline_text": "截止时间", "batch": "批次（暑期实习）",
        "announce_url": "公告链接", "apply_url": "简历投递链接",
    },
    "24-25届可投": {
        "company": "公司", "positions": "招聘岗位", "edu_requirement": "学历要求",
        "no_exam": "是否笔试", "major_requirement": "专业要求", "notes": "备注",
        "locations": "工作地点", "grad_years": "招聘届次", "updated_at_src": "更新时间",
        "company_type": "企业性质", "start_date": "开始时间", "industry": "行业分类",
        "deadline_text": "截止时间", "batch": "批次",
        "announce_url": "公告链接", "apply_url": "简历投递链接",
    },
    "免笔试汇总": {
        "company": "公司", "positions": "岗位", "no_exam": "是否免笔试",
        "notes": "备注", "locations": "工作地点", "updated_at_src": "更新时间",
        "industry": "公司行业", "batch": "招聘类型", "deadline_text": "截止日期",
        "announce_url": "公告链接", "apply_url": "投递链接", "referral_code": "内推码",
    },
    "内推码汇总": {
        "company": "企业名称", "referral_code": "内推码", "updated_at_src": "日期",
    },
    "央国企事业单位名录": {
        "company": "公司", "apply_url": "链接",
    },
    "央国企校招": {
        "company": "招聘企业", "positions": "招聘岗位", "edu_requirement": "学历要求",
        "no_exam": "是否笔试（供参考）", "major_requirement": "专业要求",
        "locations": "工作区域", "grad_years": "届次要求", "updated_at_src": "录入日期",
        "company_type": "企业性质", "industry": "行业分类", "deadline_text": "截止时间",
        "batch": "招聘批次", "announce_url": "招聘公告", "apply_url": "投递方式",
    },
}


def norm(v: str) -> str:
    return (v or "").strip()


def row_hash(source_table: str, d: dict) -> str:
    key = "|".join([source_table, d.get("company", ""), d.get("positions", ""),
                    d.get("apply_url", ""), d.get("announce_url", ""), d.get("referral_code", "")])
    return hashlib.md5(key.encode("utf-8")).hexdigest()


_SQUASH_RE = re.compile(r"[\s|,，、;；/]+")
_GRAD_SHORT_RE = re.compile(r"(?<!\d)(2\d)(届)")


def _norm_grad(v: str) -> str:
    """届次写法归一：26届 → 2026届，与四位年写法同键。"""
    return _GRAD_SHORT_RE.sub(r"20\1\2", v or "")


_URL_START_RE = re.compile(r"(https?://|mailto:)")


def _norm_url(v: str) -> str:
    """链接归一：去掉「投递邮箱:」类前缀标签，去尾斜杠。"""
    s = (v or "").strip()
    m = _URL_START_RE.search(s)
    if m:
        s = s[m.start():]
    return s.rstrip("/")


def cross_hash(company: str, positions: str, batch: str, grad_years: str,
               apply_url: str, announce_url: str) -> str:
    """跨来源去重键：忽略分隔符/空白差异，同一公司+岗位+批次+届次+链接视为同一条。"""
    key = "|".join([
        _SQUASH_RE.sub("", company or ""),
        _SQUASH_RE.sub("", clean_positions(positions)),
        _SQUASH_RE.sub("", batch or ""),
        _SQUASH_RE.sub("", _norm_grad(grad_years)),
        _norm_url(apply_url),
        _norm_url(announce_url),
    ])
    return hashlib.md5(key.encode("utf-8")).hexdigest()


def cross_hash_of(d: dict) -> str:
    return cross_hash(d.get("company", ""), d.get("positions", ""), d.get("batch", ""),
                      d.get("grad_years", ""), d.get("apply_url", ""), d.get("announce_url", ""))


def existing_cross_hashes(db) -> set[str]:
    rows = db.execute(text(
        "SELECT company, positions, batch, grad_years, apply_url, announce_url FROM campus_jobs"
    ))
    return {cross_hash(*r) for r in rows}


def import_file(db, path: str, source_table: str, colmap: dict) -> tuple[int, int]:
    added, skipped = 0, 0
    existing = {h for (h,) in db.execute(text("SELECT content_hash FROM campus_jobs"))}
    existing_cross = existing_cross_hashes(db)
    with open(path, newline="", encoding="utf-8") as fp:
        for row in csv.DictReader(fp):
            d = {field: norm(row.get(col, "")) for field, col in colmap.items()}
            if not d.get("company"):
                skipped += 1
                continue
            if "major_requirement" in d:
                d["major_requirement"] = clean_major_requirement(d["major_requirement"])
            if "positions" in d:
                d["positions"] = clean_positions(d["positions"])
            h = row_hash(source_table, d)
            xh = cross_hash_of(d)
            if h in existing or xh in existing_cross:
                skipped += 1
                continue
            existing.add(h)
            existing_cross.add(xh)
            # 截断超长字段避免插入失败
            limits = {"company": 300, "company_type": 50, "industry": 200, "batch": 100,
                      "grad_years": 100, "no_exam": 50, "edu_requirement": 200,
                      "locations": 500, "start_date": 30, "deadline_text": 200,
                      "referral_code": 200, "updated_at_src": 30, "source_table": 50}
            for k, lim in limits.items():
                if k in d and d[k]:
                    d[k] = d[k][:lim]
            db.add(CampusJob(source_table=source_table, content_hash=h, **d))
            added += 1
    db.commit()
    return added, skipped


def main():
    base_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "data", "campus")
    Base.metadata.create_all(bind=engine, tables=[CampusJob.__table__])
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
            added, skipped = import_file(db, os.path.join(base_dir, fname), st, colmap)
            print(f"{fname}: +{added} (skip {skipped})")
        total = db.query(CampusJob).count()
        print("campus_jobs total:", total)
    finally:
        db.close()


if __name__ == "__main__":
    main()
