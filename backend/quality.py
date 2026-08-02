"""三表常见脏数据扫描（只读）：各类计数 + 样例，供管理后台展示与 Celery 预热。"""
import json
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from cache import get_redis
from models import BianzhiJob, CampusJob, Position

QUALITY_ISSUES_KEY = "admin:quality_issues"
QUALITY_ISSUES_TTL = 3600
URL_LITERALS = ("投递", "公告")
OLD_DEADLINE_CUTOFF = "2020-01-01"
SAMPLE_LIMIT = 20


def _blank(col):
    return (col.is_(None)) | (func.trim(col) == "")


def _issue(db: Session, board: str, key: str, label: str, model, cond, value_col, note: str = "") -> dict:
    count = db.query(func.count(model.id)).filter(cond).scalar() or 0
    samples = []
    if count:
        rows = (
            db.query(model.id, value_col)
            .filter(cond)
            .order_by(model.id)
            .limit(SAMPLE_LIMIT)
            .all()
        )
        samples = [{"id": r[0], "value": str(r[1]) if r[1] is not None else ""} for r in rows]
    out = {"board": board, "key": key, "label": label, "count": count, "samples": samples}
    if note:
        out["note"] = note
    return out


def compute_quality_issues(db: Session) -> dict:
    pos_valid = Position.dup_of_id.is_(None) & Position.invalid_reason.is_(None)
    bz_desc = func.concat(
        func.coalesce(BianzhiJob.province, ""), func.coalesce(BianzhiJob.job_type, "")
    )
    issues = [
        _issue(
            db, "positions", "pos_empty_url", "体制内：来源链接为空",
            Position, pos_valid & _blank(Position.source_url), Position.employer,
        ),
        _issue(
            db, "positions", "pos_literal_url", "体制内：链接为「投递/公告」字面量",
            Position, pos_valid & func.trim(Position.source_url).in_(URL_LITERALS), Position.source_url,
        ),
        _issue(
            db, "positions", "pos_old_deadline", "体制内：报名截止早于 2020",
            Position, pos_valid & (Position.signup_deadline < OLD_DEADLINE_CUTOFF), Position.signup_deadline,
        ),
        _issue(
            db, "positions", "pos_empty_employer", "体制内：招考单位全空",
            Position, pos_valid & _blank(Position.employer), Position.position_example,
            note="可运行 backend/backfill_unit.py 从源站回填；回填后余量为源数据缺失，前端显示「—」",
        ),
        _issue(
            db, "campus", "campus_empty_url", "校招：公告/投递链接均为空",
            CampusJob, _blank(CampusJob.announce_url) & _blank(CampusJob.apply_url), CampusJob.company,
            note="源数据缺失（飞书表未填链接），保持不伪造",
        ),
        _issue(
            db, "campus", "campus_literal_url", "校招：链接为「投递/公告」字面量",
            CampusJob,
            func.trim(CampusJob.announce_url).in_(URL_LITERALS)
            | func.trim(CampusJob.apply_url).in_(URL_LITERALS),
            CampusJob.company,
        ),
        _issue(
            db, "campus", "campus_old_deadline", "校招：截止日期早于 2020",
            CampusJob, CampusJob.deadline_date < OLD_DEADLINE_CUTOFF, CampusJob.deadline_date,
        ),
        _issue(
            db, "campus", "campus_trailing_pipe", "校招：地点尾部多「|」",
            CampusJob, CampusJob.locations.like("%|"), CampusJob.locations,
        ),
        _issue(
            db, "campus", "campus_empty_company", "校招：公司名全空",
            CampusJob, _blank(CampusJob.company), CampusJob.positions,
        ),
        _issue(
            db, "bianzhi", "bz_empty_url", "编制：公告/投递链接均为空",
            BianzhiJob, _blank(BianzhiJob.announce_url) & _blank(BianzhiJob.apply_url), BianzhiJob.employer,
        ),
        _issue(
            db, "bianzhi", "bz_literal_url", "编制：链接为「投递/公告」字面量",
            BianzhiJob,
            func.trim(BianzhiJob.announce_url).in_(URL_LITERALS)
            | func.trim(BianzhiJob.apply_url).in_(URL_LITERALS),
            BianzhiJob.employer,
        ),
        _issue(
            db, "bianzhi", "bz_old_deadline", "编制：截止日期早于 2020",
            BianzhiJob, BianzhiJob.deadline_date < OLD_DEADLINE_CUTOFF, BianzhiJob.deadline_date,
        ),
        _issue(
            db, "bianzhi", "bz_empty_employer", "编制：招考单位全空",
            BianzhiJob, _blank(BianzhiJob.employer), bz_desc,
        ),
    ]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total": sum(i["count"] for i in issues),
        "issues": issues,
    }


def warm_quality_issues(db: Session) -> dict:
    """强制重算并写入缓存（供 Celery 预热，忽略已有缓存）。"""
    result = compute_quality_issues(db)
    try:
        get_redis().setex(QUALITY_ISSUES_KEY, QUALITY_ISSUES_TTL, json.dumps(result, default=str))
    except Exception:  # noqa: BLE001  预热失败不影响任务
        pass
    return {"total": result["total"]}
