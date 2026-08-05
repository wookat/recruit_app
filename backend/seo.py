"""SEO 静态聚合页：省份 × 考试类型 服务端渲染 HTML + 动态 sitemap。

SPA 本身不可被搜索引擎索引（客户端渲染、仅 query-param URL）。本模块在
FastAPI 层输出一组可收录的路径型页面 /zhaokao/...，含 JobPosting 结构化
数据与规范 meta，并把用户导流到 SPA 的深链筛选视图。
"""

import html
import json
from urllib.parse import quote
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

import cache
from database import get_db
from models import Position

router = APIRouter(tags=["seo"])

SITE = "https://jobs.zalize.com"
BRAND = "上岸雷达"

PROVINCES = [
    ("beijing", "北京"), ("tianjin", "天津"), ("hebei", "河北"),
    ("shanxi", "山西"), ("neimenggu", "内蒙古"), ("liaoning", "辽宁"),
    ("jilin", "吉林"), ("heilongjiang", "黑龙江"), ("shanghai", "上海"),
    ("jiangsu", "江苏"), ("zhejiang", "浙江"), ("anhui", "安徽"),
    ("fujian", "福建"), ("jiangxi", "江西"), ("shandong", "山东"),
    ("henan", "河南"), ("hubei", "湖北"), ("hunan", "湖南"),
    ("guangdong", "广东"), ("guangxi", "广西"), ("hainan", "海南"),
    ("chongqing", "重庆"), ("sichuan", "四川"), ("guizhou", "贵州"),
    ("yunnan", "云南"), ("xizang", "西藏"), ("shaanxi", "陕西"),
    ("gansu", "甘肃"), ("qinghai", "青海"), ("ningxia", "宁夏"),
    ("xinjiang", "新疆"),
]
PROV_BY_SLUG = dict(PROVINCES)
SLUG_BY_PROV = {v: k for k, v in PROVINCES}

EXAM_TYPES = [
    ("guokao", "国家公务员考试", "国考"),
    ("shengkao", "省级公务员考试", "省考"),
    ("shiye", "事业单位招聘", "事业单位"),
    ("xuandiao", "选调生", "选调生"),
    ("junwen", "军队文职招考", "军队文职"),
    ("yiliao", "医疗卫生", "医疗卫生"),
    ("jiaoshi", "教育教学", "教师招聘"),
]
ET_BY_SLUG = {s: (norm, short) for s, norm, short in EXAM_TYPES}
SLUG_BY_ET = {norm: s for s, norm, _ in EXAM_TYPES}

_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  color:#18181b;background:#fafafa;line-height:1.6}
a{color:#1d4ed8;text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:960px;margin:0 auto;padding:16px}
header.site{background:#fff;border-bottom:1px solid #e4e4e7}
header.site .wrap{display:flex;align-items:center;gap:8px;padding-top:12px;padding-bottom:12px}
.logo{font-weight:700;font-size:18px;color:#1d4ed8}
nav.crumb{font-size:13px;color:#71717a;margin:12px 0}
h1{font-size:22px;margin:8px 0 4px}
p.desc{color:#52525b;font-size:14px;margin-bottom:16px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.chips a{display:inline-block;border:1px solid #d4d4d8;border-radius:6px;background:#fff;
  padding:6px 12px;font-size:13px;color:#3f3f46}
.chips a:hover{border-color:#1d4ed8;color:#1d4ed8;text-decoration:none}
.chips a .n{color:#a1a1aa;font-size:12px;margin-left:4px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e4e4e7;
  border-radius:8px;overflow:hidden;font-size:14px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #f4f4f5;vertical-align:top}
th{background:#f4f4f5;font-size:13px;color:#52525b;white-space:nowrap}
tr:last-child td{border-bottom:none}
.cta{display:inline-block;background:#1d4ed8;color:#fff;border-radius:8px;
  padding:10px 18px;font-size:14px;margin:16px 0}
.cta:hover{background:#1e40af;text-decoration:none}
footer{color:#a1a1aa;font-size:12px;margin:24px 0 16px}
@media(max-width:640px){
  .wrap{padding:12px}
  h1{font-size:19px}
  table,thead,tbody,tr{display:block}
  thead{display:none}
  tr{border-bottom:1px solid #e4e4e7;padding:8px 0}
  td{display:block;border:none;padding:2px 12px}
  td[data-l]:before{content:attr(data-l) "：";color:#a1a1aa;font-size:12px}
}
"""


def _esc(v) -> str:
    return html.escape(str(v or ""))


def _page(title: str, desc: str, canonical: str, crumb: str, body: str,
          jsonld: str = "") -> str:
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_esc(title)}</title>
<meta name="description" content="{_esc(desc)}">
<link rel="canonical" href="{canonical}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>{_CSS}</style>
{jsonld}
</head>
<body>
<header class="site"><div class="wrap"><a class="logo" href="/">{BRAND}</a>
<span style="color:#a1a1aa;font-size:13px">全国公务员·事业单位·校招岗位库</span></div></header>
<div class="wrap">
<nav class="crumb">{crumb}</nav>
{body}
<footer>数据来自公开招考公告与官方渠道聚合，实际以官方公告为准。{BRAND} · <a href="/">jobs.zalize.com</a></footer>
</div>
</body>
</html>"""


def _active(query):
    return query.filter(Position.dup_of_id.is_(None),
                        Position.invalid_reason.is_(None))


def _job_rows(jobs) -> str:
    rows = []
    for j in jobs:
        title = (j.position_example or "").strip() or (j.exam_type_norm or j.job_type or "岗位")
        loc = "·".join(x for x in (j.city, j.district) if x) or (j.work_location or "")[:30]
        signup = (j.signup_time or "").strip()[:40] or "见公告"
        rows.append(
            f"<tr><td data-l='岗位'>{_esc(title[:60])}</td>"
            f"<td data-l='单位'>{_esc((j.employer or '')[:40])}</td>"
            f"<td data-l='地点'>{_esc(loc)}</td>"
            f"<td data-l='学历'>{_esc(j.edu_level_norm or '不限')}</td>"
            f"<td data-l='报名时间'>{_esc(signup)}</td></tr>")
    return "".join(rows)


def _jsonld(jobs, prov: str, et_norm: str) -> str:
    items = []
    for j in jobs[:20]:
        title = (j.position_example or "").strip() or (j.exam_type_norm or "岗位")
        item = {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": title[:80],
            "hiringOrganization": {"@type": "Organization",
                                   "name": (j.employer or "招录单位")[:80]},
            "jobLocation": {"@type": "Place", "address": {
                "@type": "PostalAddress", "addressRegion": prov,
                "addressLocality": j.city or prov, "addressCountry": "CN"}},
            "employmentType": "FULL_TIME",
            "industry": et_norm,
        }
        if j.created_at:
            item["datePosted"] = j.created_at.strftime("%Y-%m-%d")
        if j.signup_deadline:
            item["validThrough"] = j.signup_deadline.strftime("%Y-%m-%d")
        items.append(item)
    if not items:
        return ""
    return ("<script type=\"application/ld+json\">"
            + json.dumps(items, ensure_ascii=False) + "</script>")


@cache.cached("seo_index", ttl=3600, stale=True)
def _render_index(db: Session = None) -> str:
    counts = dict(
        _active(db.query(Position.province, func.count()))
        .group_by(Position.province).all())
    chips = "".join(
        f"<a href='/zhaokao/{slug}'>{name}<span class='n'>{counts.get(name, 0):,}</span></a>"
        for slug, name in PROVINCES)
    et_chips = "".join(
        f"<a href='/?exam_type_norm={quote(norm)}'>{short}</a>"
        for _, norm, short in EXAM_TYPES)
    total = sum(counts.get(name, 0) for _, name in PROVINCES)
    body = (f"<h1>全国公务员·事业单位招考岗位（按省份）</h1>"
            f"<p class='desc'>收录全国 31 省份共 {total:,} 个在库体制内岗位，"
            f"覆盖国考、省考、事业单位、选调生、军队文职、医疗、教师等类型，每日更新。</p>"
            f"<div class='chips'>{chips}</div>"
            f"<h2 style='font-size:16px;margin-top:20px'>按考试类型</h2>"
            f"<div class='chips'>{et_chips}</div>"
            f"<a class='cta' href='/'>打开{BRAND}筛选全部岗位 →</a>")
    crumb = f"<a href='/'>{BRAND}</a> › 招考岗位"
    return _page(f"全国公务员事业单位招考岗位大全 - {BRAND}",
                 f"{total:,} 个公务员、事业单位、选调生、教师、医疗招考岗位，按省份与考试类型浏览，每日更新。",
                 f"{SITE}/zhaokao", crumb, body)


@cache.cached("seo_prov", ttl=3600, stale=True)
def _render_province(slug: str, db: Session = None) -> str:
    prov = PROV_BY_SLUG[slug]
    et_counts = dict(
        _active(db.query(Position.exam_type_norm, func.count()))
        .filter(Position.province == prov)
        .group_by(Position.exam_type_norm).all())
    total = sum(et_counts.values())
    jobs = (_active(db.query(Position))
            .filter(Position.province == prov)
            .order_by(Position.id.desc()).limit(30).all())
    chips = "".join(
        f"<a href='/zhaokao/{slug}/{et_slug}'>{short}<span class='n'>{et_counts.get(norm, 0):,}</span></a>"
        for et_slug, norm, short in EXAM_TYPES)
    others = "".join(
        f"<a href='/zhaokao/{s}'>{n}</a>" for s, n in PROVINCES if s != slug)
    body = (f"<h1>{prov}公务员·事业单位招考岗位</h1>"
            f"<p class='desc'>{prov}在库体制内岗位共 {total:,} 个，按考试类型细分如下，每日更新。</p>"
            f"<div class='chips'>{chips}</div>"
            f"<a class='cta' href='/?province={quote(prov)}'>在{BRAND}中筛选{prov}全部岗位 →</a>"
            f"<h2 style='font-size:16px;margin:16px 0 8px'>最新岗位</h2>"
            f"<table><thead><tr><th>岗位</th><th>单位</th><th>地点</th><th>学历</th><th>报名时间</th></tr></thead>"
            f"<tbody>{_job_rows(jobs)}</tbody></table>"
            f"<h2 style='font-size:16px;margin:20px 0 8px'>其他省份</h2>"
            f"<div class='chips'>{others}</div>")
    crumb = f"<a href='/'>{BRAND}</a> › <a href='/zhaokao'>招考岗位</a> › {prov}"
    return _page(f"{prov}公务员事业单位招考岗位（{total:,} 个在招） - {BRAND}",
                 f"{prov}最新公务员、事业单位、选调生、教师、医疗招考岗位 {total:,} 个，含报名时间与学历要求，每日更新。",
                 f"{SITE}/zhaokao/{slug}", crumb, body,
                 _jsonld(jobs, prov, "招考"))


@cache.cached("seo_prov_et", ttl=3600, stale=True)
def _render_province_et(slug: str, et_slug: str, db: Session = None) -> str:
    prov = PROV_BY_SLUG[slug]
    et_norm, short = ET_BY_SLUG[et_slug]
    q = _active(db.query(Position)).filter(
        Position.province == prov, Position.exam_type_norm == et_norm)
    total = q.count()
    jobs = q.order_by(Position.id.desc()).limit(50).all()
    siblings = "".join(
        f"<a href='/zhaokao/{slug}/{s}'>{sh}</a>"
        for s, _, sh in EXAM_TYPES if s != et_slug)
    deep = f"/?province={quote(prov)}&exam_type_norm={quote(et_norm)}"
    body = (f"<h1>{prov}{short}岗位（{total:,} 个在库）</h1>"
            f"<p class='desc'>{prov}{et_norm}岗位列表，含单位、地点、学历要求与报名时间，每日更新。</p>"
            f"<a class='cta' href='{_esc(deep)}'>在{BRAND}中筛选与订阅 →</a>"
            f"<table><thead><tr><th>岗位</th><th>单位</th><th>地点</th><th>学历</th><th>报名时间</th></tr></thead>"
            f"<tbody>{_job_rows(jobs)}</tbody></table>"
            f"<h2 style='font-size:16px;margin:20px 0 8px'>{prov}其他类型</h2>"
            f"<div class='chips'>{siblings}</div>")
    crumb = (f"<a href='/'>{BRAND}</a> › <a href='/zhaokao'>招考岗位</a> › "
             f"<a href='/zhaokao/{slug}'>{prov}</a> › {short}")
    return _page(f"{prov}{short}岗位招录（{total:,} 个） - {BRAND}",
                 f"{prov}最新{et_norm}岗位 {total:,} 个：单位、工作地点、学历要求、报名时间一览，每日更新。",
                 f"{SITE}/zhaokao/{slug}/{et_slug}", crumb, body,
                 _jsonld(jobs, prov, et_norm))


@router.get("/zhaokao", response_class=HTMLResponse)
def seo_index(db: Session = Depends(get_db)):
    return HTMLResponse(_render_index(db=db))


@router.get("/zhaokao/{slug}", response_class=HTMLResponse)
def seo_province(slug: str, db: Session = Depends(get_db)):
    if slug not in PROV_BY_SLUG:
        raise HTTPException(status_code=404)
    return HTMLResponse(_render_province(slug, db=db))


@router.get("/zhaokao/{slug}/{et_slug}", response_class=HTMLResponse)
def seo_province_et(slug: str, et_slug: str, db: Session = Depends(get_db)):
    if slug not in PROV_BY_SLUG or et_slug not in ET_BY_SLUG:
        raise HTTPException(status_code=404)
    return HTMLResponse(_render_province_et(slug, et_slug, db=db))


@router.get("/sitemap.xml")
def sitemap():
    today = date.today().isoformat()

    def url(loc, priority, freq="daily"):
        return (f"<url><loc>{loc}</loc><lastmod>{today}</lastmod>"
                f"<changefreq>{freq}</changefreq><priority>{priority}</priority></url>")

    urls = [
        url(f"{SITE}/", "1.0"),
        url(f"{SITE}/?board=campus", "0.9"),
        url(f"{SITE}/?board=bianzhi", "0.9"),
        url(f"{SITE}/?board=updates", "0.8"),
        url(f"{SITE}/zhaokao", "0.9"),
    ]
    for slug, _ in PROVINCES:
        urls.append(url(f"{SITE}/zhaokao/{slug}", "0.8"))
        for et_slug, _, _ in EXAM_TYPES:
            urls.append(url(f"{SITE}/zhaokao/{slug}/{et_slug}", "0.7"))
    xml = ("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
           "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"
           + "".join(urls) + "</urlset>")
    return Response(content=xml, media_type="application/xml")
