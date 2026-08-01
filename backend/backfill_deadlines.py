"""解析 campus_jobs / bianzhi_jobs 的 deadline_text 回填 deadline_date（幂等）。

支持格式：YYYY年M月D日 / YYYY-MM-DD / YYYY.M.D / YYYY/M/D / M月D日
（无年份时推断：若该日期已过则视为明年）；区间取最后一个日期，且
无年份的后段沿用前段年份；不可解析（招满为止/详见公告等）与非法
日期（如 2月31日）保持 NULL，不伪造。

大型联考行（bianzhi_jobs.category='大型联考'）没有 deadline_text，改从
exam_time（考试时间，优先）或 signup_start 解析日期回填 deadline_date。

用法：
    python backfill_deadlines.py            # 全量回填两表（含大型联考行）
"""
import re
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text

from database import SessionLocal
from models import BianzhiJob, CampusJob

BATCH = 2000

# 依次匹配 带年份日期 与 无年份的 M月D日
_DATE_RE = re.compile(
    r"(?:(\d{4})[年./\-](\d{1,2})[月./\-](\d{1,2})日?)|(?:(?<!\d)(\d{1,2})月(\d{1,2})日)"
)


def _today_cn() -> date:
    return datetime.now(timezone(timedelta(hours=8))).date()


def parse_deadline_date(s: str, today: date = None) -> date:
    """从截止时间原文提取最后一个日期；解析不了返回 None。"""
    if not s:
        return None
    today = today or _today_cn()
    result = None
    last_year = None
    for m in _DATE_RE.finditer(s):
        if m.group(1):
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if not (1 <= mo <= 12):
                continue
            last_year = y
            try:
                result = date(y, mo, d)
            except ValueError:
                continue
        else:
            mo, d = int(m.group(4)), int(m.group(5))
            if not (1 <= mo <= 12):
                continue
            y = last_year
            if y is None:
                y = today.year
                try:
                    if date(y, mo, d) < today:
                        y += 1
                except ValueError:
                    continue
            try:
                candidate = date(y, mo, d)
            except ValueError:
                continue
            # 区间跨年（如 2025年12月20日-1月5日）：后段月份小于前段则进位
            if result is not None and candidate < result:
                try:
                    candidate = date(y + 1, mo, d)
                except ValueError:
                    continue
            result = candidate
    return result


def backfill_model(db, model, batch: int = BATCH) -> dict:
    """回填一张表中 deadline_date 为空且 deadline_text 非空的行，分批短事务。"""
    today = _today_cn()
    parsed = scanned = 0
    last_id = 0
    while True:
        rows = (
            db.query(model.id, model.deadline_text)
            .filter(model.deadline_date.is_(None),
                    model.deadline_text.isnot(None), model.deadline_text != "",
                    model.id > last_id)
            .order_by(model.id)
            .limit(batch)
            .all()
        )
        if not rows:
            break
        updates = []
        for rid, dtext in rows:
            scanned += 1
            d = parse_deadline_date(dtext, today)
            if d is not None:
                updates.append({"rid": rid, "d": d})
        if updates:
            db.execute(
                text(f"UPDATE {model.__tablename__} SET deadline_date = :d WHERE id = :rid"),
                updates,
            )
            db.commit()
            parsed += len(updates)
        last_id = rows[-1][0]
    return {"scanned": scanned, "parsed": parsed}


def backfill_lianko(db, batch: int = BATCH) -> dict:
    """回填大型联考行：从 exam_time（优先）/ signup_start 解析日期，幂等。"""
    today = _today_cn()
    parsed = scanned = 0
    last_id = 0
    while True:
        rows = (
            db.query(BianzhiJob.id, BianzhiJob.exam_time, BianzhiJob.signup_start)
            .filter(BianzhiJob.category == "大型联考",
                    BianzhiJob.deadline_date.is_(None),
                    BianzhiJob.id > last_id)
            .order_by(BianzhiJob.id)
            .limit(batch)
            .all()
        )
        if not rows:
            break
        updates = []
        for rid, exam_time, signup_start in rows:
            scanned += 1
            d = parse_deadline_date(exam_time or "", today) or parse_deadline_date(signup_start or "", today)
            if d is not None:
                updates.append({"rid": rid, "d": d})
        if updates:
            db.execute(
                text("UPDATE bianzhi_jobs SET deadline_date = :d WHERE id = :rid"),
                updates,
            )
            db.commit()
            parsed += len(updates)
        last_id = rows[-1][0]
    return {"scanned": scanned, "parsed": parsed}


def backfill_all() -> dict:
    db = SessionLocal()
    try:
        return {
            "campus_jobs": backfill_model(db, CampusJob),
            "bianzhi_jobs": backfill_model(db, BianzhiJob),
            "bianzhi_lianko": backfill_lianko(db),
        }
    finally:
        db.close()


if __name__ == "__main__":
    print(backfill_all())
