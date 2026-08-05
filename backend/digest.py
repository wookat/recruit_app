"""每日岗位精选文案生成（渠道内容冷启动素材源）。

从三板块当日新入库数据中挑选高价值岗位，渲染成可直接用于
小红书/知乎/B站动态的中文文案 markdown。产物写入 exports/，
供运营取用或后续接入自动发布。
"""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import BianzhiJob, CampusJob

SITE = "https://jobs.zalize.com"

# 精选优先的企业性质（求职者关注度高）
_PRIORITY_TYPES = ("央企", "国企", "国有", "外资", "外企", "合资")


def _day_range_utc(day: date):
    """北京时区当日 [00:00, 24:00) 对应的 UTC 区间。"""
    start = datetime(day.year, day.month, day.day, tzinfo=timezone(timedelta(hours=8)))
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def _pick_campus(db: Session, day: date, limit: int = 10):
    start, end = _day_range_utc(day)
    q = (
        db.query(CampusJob)
        .filter(CampusJob.created_at >= start, CampusJob.created_at < end)
        .filter(CampusJob.company != "", CampusJob.positions.isnot(None))
    )
    rows = q.order_by(CampusJob.deadline_date.asc().nullslast(), CampusJob.id.desc()).limit(200).all()
    rows.sort(key=lambda r: (0 if any(t in (r.company_type or "") for t in _PRIORITY_TYPES) else 1,))
    return _dedup(rows, lambda r: r.company, limit)


def _dedup(rows, key_fn, limit):
    """同一主体只保留一条，提升文案主体多样性。"""
    seen, out = set(), []
    for r in rows:
        k = (key_fn(r) or "").strip()
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
        if len(out) >= limit:
            break
    return out


def _pick_bianzhi(db: Session, day: date, limit: int = 8):
    start, end = _day_range_utc(day)
    rows = (
        db.query(BianzhiJob)
        .filter(BianzhiJob.created_at >= start, BianzhiJob.created_at < end)
        .filter(BianzhiJob.employer.isnot(None))
        .order_by(BianzhiJob.deadline_date.asc().nullslast(), BianzhiJob.id.desc())
        .limit(100)
        .all()
    )
    return _dedup(rows, lambda r: r.employer, limit)


def _fmt_deadline(deadline_date, deadline_text):
    if deadline_date:
        return f"截止 {deadline_date.strftime('%m月%d日')}"
    t = (deadline_text or "").strip()
    return f"截止 {t}" if t else "截止详见公告"


def render_digest(db: Session, day: date | None = None) -> str:
    day = day or datetime.now(timezone(timedelta(hours=8))).date()
    campus = _pick_campus(db, day)
    bianzhi = _pick_bianzhi(db, day)
    lines = [
        f"# 每日岗位精选 · {day.strftime('%Y年%m月%d日')}",
        "",
        f"今天上岸雷达新收录岗位精选（全量筛选戳 {SITE} ）：",
        "",
    ]
    if campus:
        lines.append("## 校招/社招精选")
        for r in campus:
            loc = (r.locations or "").split("、")[0].split(",")[0][:12] or "多地"
            pos = (r.positions or "").replace("\n", " ")[:24]
            lines.append(
                f"- {r.company}｜{pos}｜{loc}｜{r.grad_years or r.batch or ''}｜"
                f"{_fmt_deadline(r.deadline_date, r.deadline_text)}"
            )
        lines.append("")
    if bianzhi:
        lines.append("## 编制/央国企精选")
        for r in bianzhi:
            emp = (r.employer or "").replace("\n", " ")[:30]
            lines.append(
                f"- {emp}｜{r.category or ''}｜{r.province or ''}｜"
                f"{r.headcount or ''}｜{_fmt_deadline(r.deadline_date, r.deadline_text)}"
            )
        lines.append("")
    if not campus and not bianzhi:
        lines.append("（当日无新入库岗位，跳过发布）")
    lines += [
        "---",
        "按省份/学历/专业筛选、保存订阅提醒：上岸雷达 " + SITE,
    ]
    return "\n".join(lines)
