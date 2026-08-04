"""多维画像匹配：按用户画像（学历/多专业/意向地点/偏好）对校招、编制岗位
打分排序并逐维标注匹配原因。专业维度用 AI 语义扩展（ai_match），学历为硬约束。"""
from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ai_match import expand_majors_semantic
from bianzhi import BianzhiJobOut
from campus import CampusJobOut
from crud import edu_eligible_clause
from database import get_db
from models import BianzhiJob, CampusJob

router = APIRouter(prefix="/api/match", tags=["match"])

CANDIDATES_PER_TIER = 400
MAX_RESULTS = 60

MatchLevel = Literal["exact", "semantic", "unlimited", "none", "unset"]


class MatchProfile(BaseModel):
    edu_level: List[str] = Field(default_factory=list)
    majors: List[str] = Field(default_factory=list)
    locations: List[str] = Field(default_factory=list)
    grad_year: str = ""
    unit_types: List[str] = Field(default_factory=list)


class MatchReasons(BaseModel):
    major: MatchLevel = "unset"
    edu: Literal["ok", "unset"] = "unset"
    location: MatchLevel = "unset"
    grad_year: MatchLevel = "unset"
    unit_type: MatchLevel = "unset"


class CampusMatchItem(BaseModel):
    job: CampusJobOut
    score: int
    reasons: MatchReasons


class BianzhiMatchItem(BaseModel):
    job: BianzhiJobOut
    score: int
    reasons: MatchReasons


class CampusMatchOut(BaseModel):
    items: List[CampusMatchItem]
    expanded_terms: List[str]
    categories: List[str]
    semantic_source: Literal["ai", "rules"]


class BianzhiMatchOut(BaseModel):
    items: List[BianzhiMatchItem]
    expanded_terms: List[str]
    categories: List[str]
    semantic_source: Literal["ai", "rules"]


def _profile_edu_option(edu_level: List[str]) -> Optional[str]:
    """画像学历枚举归一到板块学历筛选值（与前端 profileEduToBoardOption 一致）。"""
    for e in edu_level:
        if "本科" in e:
            return "本科"
        if e.startswith("硕士"):
            return "硕士"
        if e.startswith("博士"):
            return "博士"
        if "大专" in e or "中专" in e:
            return "大专"
    return None


def _major_level(text: str, majors: List[str], terms: List[str]) -> MatchLevel:
    if not majors:
        return "unset"
    t = (text or "").lower()
    if not t:
        return "none"
    if any(m.lower() in t for m in majors):
        return "exact"
    if any(x.lower() in t for x in terms):
        return "semantic"
    if "不限" in t or "专业不限" in t:
        return "unlimited"
    return "none"


def _location_level(text: str, locations: List[str]) -> MatchLevel:
    if not locations:
        return "unset"
    t = text or ""
    if not t:
        return "none"
    for loc in locations:
        short = loc.rstrip("省市")
        if short and short in t:
            return "exact"
    if "全国" in t or "不限" in t:
        return "unlimited"
    return "none"


MAJOR_SCORE = {"exact": 30, "semantic": 20, "unlimited": 10, "none": 0, "unset": 0}
LOC_SCORE = {"exact": 20, "semantic": 0, "unlimited": 8, "none": 0, "unset": 0}


def _freshness_bonus(deadline: Optional[date]) -> int:
    if deadline is None:
        return 0
    return 5 if deadline >= date.today() else -15


def _candidate_conds(major_cols, majors: List[str], terms: List[str]):
    """专业分层召回条件：原词 > 语义相关词 > 不限。"""
    def hit(words):
        return or_(*(col.ilike(f"%{w}%") for col in major_cols for w in words))

    tiers = []
    if majors:
        tiers.append(hit(majors))
        if terms:
            tiers.append(hit(terms))
        tiers.append(hit(["不限"]))
    return tiers


def _collect(db, model, order_col, tiers, base_filters):
    seen: set = set()
    rows = []
    for cond in tiers:
        q = db.query(model).filter(cond, *base_filters).order_by(order_col.desc())
        for row in q.limit(CANDIDATES_PER_TIER):
            if row.id in seen:
                continue
            seen.add(row.id)
            rows.append(row)
    return rows


@router.post("/campus", response_model=CampusMatchOut)
def match_campus(profile: MatchProfile, db: Session = Depends(get_db)):
    majors = [m.strip() for m in profile.majors if m.strip()][:5]
    exp = expand_majors_semantic(majors)
    terms = exp["terms"]
    edu_opt = _profile_edu_option(profile.edu_level)
    base = [CampusJob.company != None, CampusJob.company != ""]  # noqa: E711
    if edu_opt:
        base.append(edu_eligible_clause(CampusJob.edu_requirement, edu_opt))
    major_cols = [CampusJob.major_requirement, CampusJob.positions]
    tiers = _candidate_conds(major_cols, majors, terms) or [CampusJob.id != None]  # noqa: E711
    rows = _collect(db, CampusJob, CampusJob.id, tiers, base)

    items = []
    for r in rows:
        reasons = MatchReasons(
            major=_major_level(f"{r.major_requirement or ''} {r.positions or ''}", majors, terms),
            edu="ok" if edu_opt else "unset",
            location=_location_level(r.locations or "", profile.locations),
            grad_year=(
                "unset" if not profile.grad_year
                else "exact" if profile.grad_year in (r.grad_years or "")
                else "unlimited" if "不限" in (r.grad_years or "")
                else "none"
            ),
            unit_type=(
                "unset" if not profile.unit_types
                else "exact" if any(u in (r.company_type or "") for u in profile.unit_types)
                else "none"
            ),
        )
        score = (
            MAJOR_SCORE[reasons.major]
            + LOC_SCORE[reasons.location]
            + (5 if edu_opt else 0)
            + {"exact": 10, "unlimited": 5, "none": -10, "unset": 0, "semantic": 0}[reasons.grad_year]
            + {"exact": 8, "none": 0, "unset": 0, "unlimited": 0, "semantic": 0}[reasons.unit_type]
            + _freshness_bonus(r.deadline_date)
        )
        items.append(CampusMatchItem(job=CampusJobOut.model_validate(r), score=score, reasons=reasons))
    items.sort(key=lambda x: -x.score)
    return CampusMatchOut(
        items=items[:MAX_RESULTS], expanded_terms=terms,
        categories=exp["categories"], semantic_source=exp["source"],
    )


@router.post("/bianzhi", response_model=BianzhiMatchOut)
def match_bianzhi(profile: MatchProfile, db: Session = Depends(get_db)):
    majors = [m.strip() for m in profile.majors if m.strip()][:5]
    exp = expand_majors_semantic(majors)
    terms = exp["terms"]
    edu_opt = _profile_edu_option(profile.edu_level)
    base = [BianzhiJob.employer != None, BianzhiJob.employer != ""]  # noqa: E711
    if edu_opt:
        base.append(edu_eligible_clause(BianzhiJob.edu_requirement, edu_opt))
    major_cols = [BianzhiJob.major_requirement, BianzhiJob.job_type]
    tiers = _candidate_conds(major_cols, majors, terms) or [BianzhiJob.id != None]  # noqa: E711
    rows = _collect(db, BianzhiJob, BianzhiJob.id, tiers, base)

    items = []
    for r in rows:
        loc_text = f"{r.province or ''} {r.work_location or ''}"
        reasons = MatchReasons(
            major=_major_level(f"{r.major_requirement or ''} {r.job_type or ''}", majors, terms),
            edu="ok" if edu_opt else "unset",
            location=_location_level(loc_text, profile.locations),
            grad_year="unset",
            unit_type=(
                "unset" if not profile.unit_types
                else "exact" if any(u in (r.category or "") for u in profile.unit_types)
                else "none"
            ),
        )
        score = (
            MAJOR_SCORE[reasons.major]
            + LOC_SCORE[reasons.location]
            + (5 if edu_opt else 0)
            + {"exact": 8, "none": 0, "unset": 0, "unlimited": 0, "semantic": 0}[reasons.unit_type]
            + _freshness_bonus(r.deadline_date)
        )
        items.append(BianzhiMatchItem(job=BianzhiJobOut.model_validate(r), score=score, reasons=reasons))
    items.sort(key=lambda x: -x.score)
    return BianzhiMatchOut(
        items=items[:MAX_RESULTS], expanded_terms=terms,
        categories=exp["categories"], semantic_source=exp["source"],
    )
