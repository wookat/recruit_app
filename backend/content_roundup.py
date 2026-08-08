"""周更盘点内容流水线（R302）：数据资产 → 可直接发布的多平台内容。

每周生成三类盘点（省份体制内新增盘点 / 三不限岗位周报 / 应届生央国企校招周榜），
每类输出两种版式（小红书风短文 + 知乎/公众号风长文 markdown），并为每篇附
带 utm_source 归因参数的站内深链与对应二维码 PNG。产物写入
exports/content/<YYYY-Www>/，管理后台可列出下载。

文案以规则模板 + 真实数据填充为主，仅导语可选 DeepSeek 润色（带缓存与降级，
数字与链接不经过 LLM，杜绝编造数据）。
"""
import hashlib
import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from cache import get_redis
from seo import _SBX_WHERE

SITE = "https://jobs.zalize.com"

EXPORTS_DIR = os.getenv(
    "EXPORTS_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "exports"),
)
CONTENT_DIR = os.path.join(EXPORTS_DIR, "content")

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
POLISH_CACHE_TTL = 14 * 86400

#: 版式 → utm_source（归因渠道；同一版式发不同平台可再人工改后缀）
UTM_BY_STYLE = {"xhs": "xhs", "long": "gzh"}


def _today_cn() -> date:
    return datetime.now(timezone(timedelta(hours=8))).date()


def _week_tag(day: date) -> str:
    y, w, _ = day.isocalendar()
    return f"{y}-W{w:02d}"


def deep_link(path: str, utm_source: str, campaign: str) -> str:
    """站内深链 + utm 归因参数（utm_source 会被前端 metrics 上报记录）。"""
    sep = "&" if "?" in path else "?"
    return f"{SITE}{path}{sep}utm_source={quote(utm_source)}&utm_campaign={quote(campaign)}"


def make_qr(url: str, path: str) -> str:
    import qrcode

    img = qrcode.make(url, box_size=8, border=2)
    img.save(path)
    return path


def _polish(text_in: str, cache_suffix: str) -> str:
    """DeepSeek 润色导语（可选）：仅改措辞，不得改数字；失败/未配置时原样返回。"""
    if not DEEPSEEK_API_KEY or not text_in.strip():
        return text_in
    key = "content_polish:v1:" + hashlib.md5((cache_suffix + text_in).encode()).hexdigest()
    try:
        cached = get_redis().get(key)
        if cached:
            return cached.decode() if isinstance(cached, bytes) else str(cached)
    except Exception:
        pass
    try:
        r = requests.post(
            DEEPSEEK_URL,
            headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
            json={
                "model": "deepseek-chat",
                "messages": [{
                    "role": "user",
                    "content": (
                        "请润色下面这段求职内容导语，使其更口语化、有吸引力。"
                        "严格要求：不得改动或新增任何数字、单位名、日期和链接；"
                        "不得编造事实；长度不超过原文 1.5 倍；只输出润色后的文本。\n\n" + text_in
                    ),
                }],
                "temperature": 0.4,
                "max_tokens": 400,
            },
            timeout=12,
        )
        r.raise_for_status()
        out = (r.json()["choices"][0]["message"]["content"] or "").strip()
        # 数字守恒校验：润色后数字集合必须与原文完全一致，否则丢弃润色结果
        if out and sorted(re.findall(r"\d+", out)) == sorted(re.findall(r"\d+", text_in)):
            try:
                get_redis().setex(key, POLISH_CACHE_TTL, out)
            except Exception:
                pass
            return out
    except Exception:
        pass
    return text_in


def _fmt_deadline(d) -> str:
    if not d:
        return "详见公告"
    if isinstance(d, datetime):
        d = d.date()
    return d.strftime("%m月%d日")


# ---------------------------------------------------------------- 数据统计


def province_weekly_stats(db: Session, day: date | None = None, days: int = 7) -> dict:
    """近 N 天新增体制内岗位最多的省份及其分布统计。"""
    day = day or _today_cn()
    since = day - timedelta(days=days)
    base = ("dup_of_id IS NULL AND invalid_reason IS NULL AND province IS NOT NULL"
            " AND job_type IN ('公务员', '事业单位/事业编', '军队文职', '选调生', '教师', '三支一扶')"
            " AND COALESCE(exam_type_norm, '其他') <> '其他'"
            " AND created_at >= :since")
    prov_row = db.execute(text(
        f"SELECT province, count(*) FROM positions WHERE {base}"
        " GROUP BY 1 ORDER BY 2 DESC LIMIT 1"), {"since": since}).first()
    if not prov_row:
        return {}
    prov, new_cnt = prov_row[0], int(prov_row[1])
    where = base + " AND province = :prov"
    params = {"since": since, "prov": prov}
    units = db.execute(text(
        f"SELECT employer, count(*) FROM positions WHERE {where}"
        " AND employer IS NOT NULL AND employer <> ''"
        " GROUP BY 1 ORDER BY 2 DESC LIMIT 8"), params).all()
    edu = db.execute(text(
        f"SELECT COALESCE(edu_level_norm, '其他/不限'), count(*) FROM positions WHERE {where}"
        " GROUP BY 1 ORDER BY 2 DESC"), params).all()
    closing = db.execute(text(
        f"SELECT employer, position_example, signup_deadline FROM positions WHERE {where}"
        " AND signup_deadline >= now() ORDER BY signup_deadline ASC LIMIT 5"), params).all()
    return {
        "province": prov, "new_count": new_cnt, "days": days,
        "top_units": [(u, int(n)) for u, n in units],
        "edu_dist": [(e, int(n)) for e, n in edu],
        "closing": [(e or "", (p or "").replace("\n", " ")[:24], d) for e, p, d in closing],
        "path": f"/?province={quote(prov)}",
        "day": day.isoformat(),
    }


def sanbuxian_weekly_stats(db: Session, day: date | None = None, days: int = 7) -> dict:
    """三不限口径周报：在库总量、近 N 天新增、省份 Top、临近截止 Top。"""
    day = day or _today_cn()
    since = day - timedelta(days=days)
    total = db.execute(text(
        "SELECT count(*) FROM positions WHERE " + _SBX_WHERE)).scalar() or 0
    new_cnt = db.execute(text(
        "SELECT count(*) FROM positions WHERE " + _SBX_WHERE +
        " AND created_at >= :since"), {"since": since}).scalar() or 0
    provs = db.execute(text(
        "SELECT province, count(*) FROM positions WHERE " + _SBX_WHERE +
        " AND province IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8")).all()
    closing = db.execute(text(
        "SELECT employer, position_example, province, signup_deadline FROM positions WHERE "
        + _SBX_WHERE +
        " AND signup_deadline >= now() ORDER BY signup_deadline ASC LIMIT 5")).all()
    return {
        "total": int(total), "new_count": int(new_cnt), "days": days,
        "top_provinces": [(p, int(n)) for p, n in provs],
        "closing": [(e or "", (po or "").replace("\n", " ")[:24], pr or "", d)
                    for e, po, pr, d in closing],
        "path": "/rank/sanbuxian",
        "day": day.isoformat(),
    }


def campus_soe_weekly_stats(db: Session, day: date | None = None, days: int = 7) -> dict:
    """应届生央国企校招周榜：近 N 天新增央国企主体与临近截止。"""
    day = day or _today_cn()
    since = day - timedelta(days=days)
    where = ("invalid_reason IS NULL AND company <> ''"
             " AND company_type LIKE '%央国企%' AND created_at >= :since")
    new_cnt = db.execute(text(
        f"SELECT count(*) FROM campus_jobs WHERE {where}"), {"since": since}).scalar() or 0
    companies = db.execute(text(
        f"SELECT company, count(*) FROM campus_jobs WHERE {where}"
        " GROUP BY 1 ORDER BY 2 DESC LIMIT 10"), {"since": since}).all()
    closing = db.execute(text(
        f"SELECT company, positions, deadline_date FROM campus_jobs WHERE {where}"
        " AND deadline_date >= CURRENT_DATE ORDER BY deadline_date ASC LIMIT 5"),
        {"since": since}).all()
    return {
        "new_count": int(new_cnt), "days": days,
        "top_companies": [(c, int(n)) for c, n in companies],
        "closing": [(c or "", (p or "").replace("\n", " ")[:24], d) for c, p, d in closing],
        "path": "/?board=campus&ctype=" + quote("央国企"),
        "day": day.isoformat(),
    }


# ---------------------------------------------------------------- 渲染


def _hashtags(tags: list[str]) -> str:
    return " ".join("#" + t for t in tags)


def _link_block(url: str, qr_name: str) -> list[str]:
    return [
        "",
        f"👉 全量岗位与筛选：{url}",
        f"（配图二维码：{qr_name}，扫码直达）",
    ]


def render_province(s: dict, style: str, url: str, qr_name: str) -> str:
    prov, n, days = s["province"], s["new_count"], s["days"]
    if style == "xhs":
        lines = [
            f"📢 本周{prov}体制内新增 {n} 个岗位！",
            "",
            _polish(f"最近 {days} 天{prov}一口气上新了 {n} 个体制内岗位，想上岸的姐妹冲！",
                    f"prov-{prov}-{s['day']}"),
            "",
            "🔥 招聘大户（新增岗位数）：",
        ]
        lines += [f"· {u}（{c} 个）" for u, c in s["top_units"][:5]]
        lines += ["", "🎓 学历门槛分布："]
        lines += [f"· {e}：{c} 个" for e, c in s["edu_dist"][:5]]
        if s["closing"]:
            lines += ["", "⏰ 马上截止，别错过："]
            lines += [f"· {e}｜{p}｜截止 {_fmt_deadline(d)}" for e, p, d in s["closing"]]
        lines += _link_block(url, qr_name)
        lines += ["", _hashtags([f"{prov}公务员", "体制内", "事业编", "考公上岸", "应届生求职"])]
        return "\n".join(lines)
    lines = [
        f"# 本周新增{prov}体制内岗位盘点（截至 {s['day']}）",
        "",
        _polish(
            f"过去 {days} 天，上岸雷达共收录{prov}新增体制内岗位 {n} 个。"
            "本文按招录单位、学历门槛与报名截止时间做一次系统盘点，供备考选岗参考。",
            f"prov-long-{prov}-{s['day']}"),
        "",
        "## 一、热门招录单位（按新增岗位数）",
        "",
        "| 单位 | 新增岗位数 |",
        "| --- | --- |",
    ]
    lines += [f"| {u} | {c} |" for u, c in s["top_units"]]
    lines += ["", "## 二、学历门槛分布", "", "| 学历要求 | 岗位数 |", "| --- | --- |"]
    lines += [f"| {e} | {c} |" for e, c in s["edu_dist"]]
    if s["closing"]:
        lines += ["", "## 三、临近截止 Top", "", "| 单位 | 岗位 | 报名截止 |", "| --- | --- | --- |"]
        lines += [f"| {e} | {p} | {_fmt_deadline(d)} |" for e, p, d in s["closing"]]
    lines += [
        "",
        "## 数据说明与入口",
        "",
        f"以上数据来自上岸雷达数据库（统计窗口：近 {days} 天新收录、去重后的有效岗位），"
        "岗位详情与报名入口以官方公告为准。",
        "",
        f"按省份/学历/专业继续筛选：{url}",
        f"（二维码见附图 {qr_name}）",
    ]
    return "\n".join(lines)


def render_sanbuxian(s: dict, style: str, url: str, qr_name: str) -> str:
    total, n, days = s["total"], s["new_count"], s["days"]
    if style == "xhs":
        lines = [
            f"🆓 三不限岗位周报：在库 {total} 个，本周新增 {n} 个！",
            "",
            _polish(
                f"专业不限+学历门槛低+不要工作经验的「三不限」岗位，全站现在有 {total} 个，"
                f"最近 {days} 天又新增了 {n} 个！", f"sbx-{s['day']}"),
            "",
            "📍 三不限岗位最多的省份：",
        ]
        lines += [f"· {p}：{c} 个" for p, c in s["top_provinces"][:5]]
        if s["closing"]:
            lines += ["", "⏰ 临近截止："]
            lines += [f"· {e}｜{pr}｜截止 {_fmt_deadline(d)}" for e, _p, pr, d in s["closing"]]
        lines += _link_block(url, qr_name)
        lines += ["", _hashtags(["三不限", "考公", "不限专业", "大专可报", "上岸"])]
        return "\n".join(lines)
    lines = [
        f"# 三不限岗位周报（截至 {s['day']}）",
        "",
        _polish(
            f"「三不限」指专业不限、学历门槛低（大专/中专或不限）、无工作经历要求的体制内岗位。"
            f"截至本期，上岸雷达在库三不限岗位共 {total} 个，近 {days} 天新增 {n} 个。",
            f"sbx-long-{s['day']}"),
        "",
        "## 一、省份分布 Top",
        "",
        "| 省份 | 在库三不限岗位数 |",
        "| --- | --- |",
    ]
    lines += [f"| {p} | {c} |" for p, c in s["top_provinces"]]
    if s["closing"]:
        lines += ["", "## 二、临近截止 Top", "",
                  "| 单位 | 岗位 | 省份 | 报名截止 |", "| --- | --- | --- | --- |"]
        lines += [f"| {e} | {p} | {pr} | {_fmt_deadline(d)} |" for e, p, pr, d in s["closing"]]
    lines += [
        "",
        "## 口径与入口",
        "",
        "三不限口径：专业不限 + 学历大专/中专或不限 + 无工作经历/经验要求（去重后的有效岗位）。"
        "岗位详情与报名入口以官方公告为准。",
        "",
        f"三不限岗位实时雷达：{url}",
        f"（二维码见附图 {qr_name}）",
    ]
    return "\n".join(lines)


def render_campus_soe(s: dict, style: str, url: str, qr_name: str) -> str:
    n, days = s["new_count"], s["days"]
    if style == "xhs":
        lines = [
            f"🏢 应届生央国企校招周榜：本周新增 {n} 条！",
            "",
            _polish(f"最近 {days} 天新收录 {n} 条央国企校招信息，应届的宝子们抓紧投！",
                    f"soe-{s['day']}"),
            "",
            "🔥 本周在招央国企 Top：",
        ]
        lines += [f"· {c}（{k} 条）" for c, k in s["top_companies"][:6]]
        if s["closing"]:
            lines += ["", "⏰ 临近截止："]
            lines += [f"· {c}｜{p}｜截止 {_fmt_deadline(d)}" for c, p, d in s["closing"]]
        lines += _link_block(url, qr_name)
        lines += ["", _hashtags(["央国企", "校招", "应届生", "秋招", "国企招聘"])]
        return "\n".join(lines)
    lines = [
        f"# 应届生央国企校招周榜（截至 {s['day']}）",
        "",
        _polish(
            f"过去 {days} 天，上岸雷达共收录央国企校招信息 {n} 条。"
            "本文按招聘主体与报名截止时间盘点，供应届生投递参考。",
            f"soe-long-{s['day']}"),
        "",
        "## 一、本周在招央国企 Top（按新增条数）",
        "",
        "| 企业 | 新增条数 |",
        "| --- | --- |",
    ]
    lines += [f"| {c} | {k} |" for c, k in s["top_companies"]]
    if s["closing"]:
        lines += ["", "## 二、临近截止 Top", "", "| 企业 | 岗位 | 报名截止 |", "| --- | --- | --- |"]
        lines += [f"| {c} | {p} | {_fmt_deadline(d)} |" for c, p, d in s["closing"]]
    lines += [
        "",
        "## 数据说明与入口",
        "",
        f"以上数据来自上岸雷达校招板块（统计窗口：近 {days} 天新收录、去重后的有效信息），"
        "投递入口以企业官方公告为准。",
        "",
        f"央国企校招全量列表：{url}",
        f"（二维码见附图 {qr_name}）",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------- 主流程

_TYPES = (
    ("province", province_weekly_stats, render_province, "weekly-province"),
    ("sanbuxian", sanbuxian_weekly_stats, render_sanbuxian, "weekly-sanbuxian"),
    ("campus-soe", campus_soe_weekly_stats, render_campus_soe, "weekly-campus-soe"),
)


def generate_weekly_content(db: Session, day: date | None = None) -> dict:
    """生成一期三类 × 两版式盘点内容与二维码，写入 exports/content/<周>/。"""
    day = day or _today_cn()
    week = _week_tag(day)
    out_dir = os.path.join(CONTENT_DIR, week)
    os.makedirs(out_dir, exist_ok=True)
    files, skipped = [], []
    for name, stats_fn, render_fn, campaign in _TYPES:
        s = stats_fn(db, day)
        if not s or not s.get("new_count"):
            skipped.append(name)
            continue
        for style in ("xhs", "long"):
            utm = UTM_BY_STYLE[style]
            url = deep_link(s["path"], utm, f"{campaign}-{week}")
            qr_name = f"{name}-{style}-qr.png"
            make_qr(url, os.path.join(out_dir, qr_name))
            md = render_fn(s, style, url, qr_name)
            fname = f"{name}-{style}.md"
            with open(os.path.join(out_dir, fname), "w", encoding="utf-8") as f:
                f.write(md)
            files += [f"{week}/{fname}", f"{week}/{qr_name}"]
    manifest = {"week": week, "day": day.isoformat(),
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "files": files, "skipped": skipped}
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    return manifest


def list_content_files() -> list[dict]:
    """管理后台用：列出 exports/content/ 下全部产物（按周目录倒序）。"""
    out = []
    if not os.path.isdir(CONTENT_DIR):
        return out
    for week in sorted(os.listdir(CONTENT_DIR), reverse=True):
        wdir = os.path.join(CONTENT_DIR, week)
        if not os.path.isdir(wdir):
            continue
        for fn in sorted(os.listdir(wdir)):
            p = os.path.join(wdir, fn)
            if os.path.isfile(p):
                out.append({"week": week, "name": fn, "path": f"{week}/{fn}",
                            "size": os.path.getsize(p),
                            "mtime": datetime.fromtimestamp(os.path.getmtime(p),
                                                            tz=timezone.utc).isoformat()})
    return out
