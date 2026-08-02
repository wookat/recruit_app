"""岗位深链分享卡片：对带 ?job=board:id 的 HTML 请求注入 title/og 描述。

微信/QQ 等抓取分享链接时拿到「岗位名 - 单位 | 板块名」与截止/地点/学历摘要，
而非通用站点文案。查不到 id 或参数非法时回退默认 index.html。
"""
import html
import re

from sqlalchemy import text

import cache

BOARD_NAMES = {"positions": "体制内岗位", "campus": "校招信息", "bianzhi": "编制公告"}

_JOB_KEY_RE = re.compile(r"^(positions|campus|bianzhi):(\d{1,10})$")

META_TTL = 600  # 岗位 meta 短缓存，避免每次分享抓取都查库


def parse_job_key(value: str) -> tuple[str, int] | None:
    m = _JOB_KEY_RE.match(value or "")
    if not m:
        return None
    return m.group(1), int(m.group(2))


def _summary(parts: list[str | None]) -> str:
    return " · ".join(p.strip() for p in parts if p and p.strip())


def _load_meta(db, board: str, job_id: int) -> dict | None:
    if board == "positions":
        row = db.execute(text("""
            SELECT coalesce(nullif(position_example, ''), exam_type) AS title,
                   employer, work_location, edu_requirement, signup_time
            FROM positions WHERE id = :id AND dup_of_id IS NULL AND invalid_reason IS NULL
        """), {"id": job_id}).first()
        if not row:
            return None
        return {
            "title": row.title,
            "org": row.employer,
            "summary": _summary([
                f"截止 {row.signup_time}" if row.signup_time else None,
                row.work_location,
                row.edu_requirement,
            ]),
        }
    if board == "campus":
        row = db.execute(text("""
            SELECT coalesce(nullif(positions, ''), batch) AS title,
                   company, locations, edu_requirement, deadline_text
            FROM campus_jobs WHERE id = :id
        """), {"id": job_id}).first()
        if not row:
            return None
        return {
            "title": row.title,
            "org": row.company,
            "summary": _summary([
                f"截止 {row.deadline_text}" if row.deadline_text else None,
                row.locations,
                row.edu_requirement,
            ]),
        }
    row = db.execute(text("""
        SELECT coalesce(nullif(employer, ''), concat(province, category)) AS title,
               nullif(employer, '') AS org, coalesce(nullif(work_location, ''), province) AS loc,
               edu_requirement, deadline_text
        FROM bianzhi_jobs WHERE id = :id
    """), {"id": job_id}).first()
    if not row:
        return None
    return {
        "title": row.title,
        "org": row.org,
        "summary": _summary([
            f"截止 {row.deadline_text}" if row.deadline_text else None,
            row.loc,
            row.edu_requirement,
        ]),
    }


def get_share_meta(db, job_key: str) -> dict | None:
    """岗位分享 meta（title/description），带 redis 短缓存；查不到返回 None。"""
    parsed = parse_job_key(job_key)
    if not parsed:
        return None
    board, job_id = parsed

    def compute():
        meta = _load_meta(db, board, job_id)
        if not meta:
            return {}
        head = (meta["title"] or "").strip()[:60]
        org = (meta["org"] or "").strip()[:40]
        if org and org != head:
            head = f"{head} - {org}" if head else org
        title = f"{head} | {BOARD_NAMES[board]} - 上岸罗盘" if head else ""
        desc = meta["summary"][:150] or f"{BOARD_NAMES[board]}岗位详情，报名条件与官方公告入口见站内。"
        return {"title": title, "desc": desc}

    result = cache.get_or_set(f"share_meta:{board}:{job_id}", META_TTL, compute)
    return result if result and result.get("title") else None


_TITLE_RE = re.compile(r"<title>.*?</title>", re.S)
_META_RES = [
    (re.compile(r'(<meta\s+property="og:title"\s+content=")[^"]*(")'), "title"),
    (re.compile(r'(<meta\s+name="twitter:title"\s+content=")[^"]*(")'), "title"),
    (re.compile(r'(<meta\s+name="description"\s+content=")[^"]*(")', re.S), "desc"),
    (re.compile(r'(<meta\s+property="og:description"\s+content=")[^"]*(")', re.S), "desc"),
    (re.compile(r'(<meta\s+name="twitter:description"\s+content=")[^"]*(")', re.S), "desc"),
]


def inject_meta(index_html: str, title: str, desc: str) -> str:
    t = html.escape(title, quote=True)
    d = html.escape(desc, quote=True)
    out = _TITLE_RE.sub(f"<title>{t}</title>", index_html, count=1)
    for pattern, kind in _META_RES:
        out = pattern.sub(lambda m, v=(t if kind == "title" else d): f"{m.group(1)}{v}{m.group(2)}", out, count=1)
    return out
