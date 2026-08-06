"""SEO 静态聚合页：省份 × 考试类型 服务端渲染 HTML + 动态 sitemap。

SPA 本身不可被搜索引擎索引（客户端渲染、仅 query-param URL）。本模块在
FastAPI 层输出一组可收录的路径型页面 /zhaokao/...，含 JobPosting 结构化
数据与规范 meta，并把用户导流到 SPA 的深链筛选视图。
"""

import html
import json
import os
from urllib.parse import quote
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, Response
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

import cache
from database import get_db
from major_pages import MAJOR_BY_SLUG, MAJOR_DISCIPLINES, resolve_major_alias
from models import BianzhiJob, CampusJob, DailyDigest, Position

router = APIRouter(tags=["seo"])

# SSR 页 Redis 缓存 TTL：内容每日采集后由 warm_seo_pages 失效并重渲染，
# TTL 取 26h 保证两次预热之间始终命中热缓存（冷 TTFB 根治）
SEO_TTL = 26 * 3600
# 边缘/共享缓存：内容每日更新，s-maxage 1h + SWR 1 天兼顾新鲜度与冷访问速度
HTML_CACHE_CONTROL = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400"


def _html(content: str) -> HTMLResponse:
    return HTMLResponse(content, headers={"Cache-Control": HTML_CACHE_CONTROL})


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

# 城市×板块聚合页：岗位量 Top 城市（按在库量选取，另含深珠佛莞重点城市）。
# (省 slug, 城市 slug, 城市名)；slug 为拼音，直辖市与省页重合故不设城市页。
CITIES = [
    ("hubei", "wuhan", "武汉"), ("hubei", "jingzhou", "荆州"),
    ("hubei", "huanggang", "黄冈"), ("hubei", "xiaogan", "孝感"),
    ("hubei", "xiangyang", "襄阳"), ("hubei", "jingmen", "荆门"),
    ("hubei", "yichang", "宜昌"),
    ("neimenggu", "hulunbeier", "呼伦贝尔"), ("neimenggu", "chifeng", "赤峰"),
    ("neimenggu", "tongliao", "通辽"), ("neimenggu", "bayannaoer", "巴彦淖尔"),
    ("neimenggu", "huhehaote", "呼和浩特"), ("neimenggu", "xilinguole", "锡林郭勒"),
    ("neimenggu", "wulanchabu", "乌兰察布"), ("neimenggu", "xingan", "兴安"),
    ("neimenggu", "baotou", "包头"), ("neimenggu", "eerduosi", "鄂尔多斯"),
    ("jiangsu", "nanjing", "南京"), ("jiangsu", "suzhou", "苏州"),
    ("jiangsu", "wuxi", "无锡"), ("jiangsu", "yancheng", "盐城"),
    ("jiangsu", "nantong", "南通"),
    ("guizhou", "bijie", "毕节"), ("guizhou", "zunyi", "遵义"),
    ("guizhou", "guiyang", "贵阳"), ("guizhou", "qiandongnan", "黔东南"),
    ("guizhou", "anshun", "安顺"), ("guizhou", "tongren", "铜仁"),
    ("guizhou", "liupanshui", "六盘水"), ("guizhou", "qiannan", "黔南"),
    ("guizhou", "qianxinan", "黔西南"),
    ("henan", "anyang", "安阳"), ("henan", "shangqiu", "商丘"),
    ("henan", "zhengzhou", "郑州"), ("henan", "zhoukou", "周口"),
    ("henan", "luohe", "漯河"), ("henan", "xinxiang", "新乡"),
    ("henan", "pingdingshan", "平顶山"), ("henan", "nanyang", "南阳"),
    ("henan", "jiaozuo", "焦作"), ("henan", "luoyang", "洛阳"),
    ("shaanxi", "xian", "西安"),
    ("sichuan", "chengdu", "成都"),
    ("guangdong", "guangzhou", "广州"), ("guangdong", "shenzhen", "深圳"),
    ("guangdong", "zhuhai", "珠海"), ("guangdong", "foshan", "佛山"),
    ("guangdong", "dongguan", "东莞"),
    ("guangxi", "nanning", "南宁"), ("guangxi", "liuzhou", "柳州"),
    ("guangxi", "baise", "百色"), ("guangxi", "guilin", "桂林"),
    ("guangxi", "wuzhou", "梧州"), ("guangxi", "yulin", "玉林"),
    ("shandong", "jinan", "济南"), ("shandong", "qingdao", "青岛"),
    ("shandong", "yantai", "烟台"), ("shandong", "dezhou", "德州"),
    ("shandong", "weifang", "潍坊"), ("shandong", "jining", "济宁"),
    ("shandong", "taian", "泰安"),
    ("anhui", "hefei", "合肥"),
    ("xinjiang", "wulumuqi", "乌鲁木齐"),
    ("shanxi", "yuncheng", "运城"), ("shanxi", "linfen", "临汾"),
    ("shanxi", "lvliang", "吕梁"), ("shanxi", "taiyuan", "太原"),
    ("shanxi", "jinzhong", "晋中"), ("shanxi", "changzhi", "长治"),
    ("gansu", "lanzhou", "兰州"),
    ("zhejiang", "hangzhou", "杭州"), ("zhejiang", "ningbo", "宁波"),
    ("fujian", "quanzhou", "泉州"), ("fujian", "fuzhou", "福州"),
    ("fujian", "zhangzhou", "漳州"), ("fujian", "ningde", "宁德"),
    ("liaoning", "shenyang", "沈阳"), ("liaoning", "dalian", "大连"),
    ("ningxia", "yinchuan", "银川"),
    ("hebei", "shijiazhuang", "石家庄"),
]
CITY_BY_SLUG = {(p, c): name for p, c, name in CITIES}
CITIES_BY_PROV: dict = {}
for _p, _c, _n in CITIES:
    CITIES_BY_PROV.setdefault(_p, []).append((_c, _n))

_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  color:#18181b;background:#fafafa;line-height:1.6}
a{color:#1d4ed8;text-decoration:underline}
.chips a,.cta,.logo{text-decoration:none}
.wrap{max-width:960px;margin:0 auto;padding:16px}
header.site{background:#fff;border-bottom:1px solid #e4e4e7}
header.site .wrap{display:flex;align-items:center;gap:8px;padding-top:12px;padding-bottom:12px}
.logo{font-weight:700;font-size:18px;color:#1d4ed8}
nav.crumb{font-size:13px;color:#52525b;margin:12px 0}
h1{font-size:22px;margin:8px 0 4px}
p.desc{color:#52525b;font-size:14px;margin-bottom:16px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.chips a{display:inline-block;border:1px solid #d4d4d8;border-radius:6px;background:#fff;
  padding:6px 12px;font-size:13px;color:#3f3f46}
.chips a:hover{border-color:#1d4ed8;color:#1d4ed8;text-decoration:none}
.chips a .n{color:#52525b;font-size:12px;margin-left:4px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e4e4e7;
  border-radius:8px;overflow:hidden;font-size:14px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #f4f4f5;vertical-align:top}
th{background:#f4f4f5;font-size:13px;color:#52525b;white-space:nowrap}
tr:last-child td{border-bottom:none}
.cta{display:inline-block;background:#1d4ed8;color:#fff;border-radius:8px;
  padding:10px 18px;font-size:14px;margin:16px 0}
.cta:hover{background:#1e40af;text-decoration:none}
footer{color:#52525b;font-size:12px;margin:24px 0 16px}
@media(max-width:640px){
  .wrap{padding:12px}
  h1{font-size:19px}
  table,thead,tbody,tr{display:block}
  thead{display:none}
  tr{border-bottom:1px solid #e4e4e7;padding:8px 0}
  td{display:block;border:none;padding:2px 12px}
  td[data-l]:before{content:attr(data-l) "：";color:#52525b;font-size:12px}
}
@media(prefers-color-scheme:dark){
  body{color:#e4e4e7;background:#09090b}
  a{color:#60a5fa}
  header.site{background:#18181b;border-color:#27272a}
  .logo{color:#60a5fa}
  nav.crumb,p.desc,footer,.chips a .n{color:#a1a1aa}
  .chips a{border-color:#3f3f46;background:#18181b;color:#d4d4d8}
  .chips a:hover{border-color:#60a5fa;color:#60a5fa}
  table{background:#18181b;border-color:#27272a}
  th{background:#27272a;color:#a1a1aa}
  th,td{border-color:#27272a}
  .cta{background:#2563eb;color:#fff}
  .cta:hover{background:#1d4ed8}
  @media(max-width:640px){tr{border-color:#27272a}}
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
<meta name="color-scheme" content="light dark">
<title>{_esc(title)}</title>
<meta name="description" content="{_esc(desc)}">
<link rel="canonical" href="{canonical}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>{_CSS}</style>
{jsonld}
</head>
<body>
<header class="site"><div class="wrap"><a class="logo" href="/">{BRAND}</a>
<span style="color:#52525b;font-size:13px">全国公务员·事业单位·校招岗位库</span></div></header>
<main class="wrap">
<nav class="crumb">{crumb}</nav>
{body}
<footer>数据来自公开招考公告与官方渠道聚合，实际以官方公告为准。{BRAND} · <a href="/">jobs.zalize.com</a></footer>
</main>
</body>
</html>"""


def render_404() -> str:
    """品牌化 404 页：SSR 路径（/zhaokao、/daily、/major 等）无效时返回，替代裸 JSON。"""
    body = (f"<h1>页面不存在（404）</h1>"
            f"<p class='desc'>你访问的页面不存在或已下线，可能是链接拼写有误、"
            f"或对应的岗位聚合页已因数据变化下线。</p>"
            f"<div class='chips'>"
            f"<a href='/zhaokao'>按省份浏览招考岗位</a>"
            f"<a href='/major'>按专业反查可报岗位</a>"
            f"<a href='/daily'>每日岗位精选</a></div>"
            f"<a class='cta' href='/'>返回{BRAND}首页 →</a>")
    crumb = f"<a href='/'>{BRAND}</a> › 404"
    return _page(f"页面不存在 - {BRAND}",
                 "你访问的页面不存在，返回上岸雷达首页浏览全国公务员、事业单位与校招岗位。",
                 f"{SITE}/", crumb, body)


def _active(query):
    return query.filter(Position.dup_of_id.is_(None),
                        Position.invalid_reason.is_(None))


def _month_start() -> datetime:
    today = date.today()
    return datetime(today.year, today.month, 1)


def _stats_para(scope: str, total: int, month_new: int, et_counts: dict) -> str:
    """聚合统计文字段落：提升页面文本密度，避免被判「内容过薄」。"""
    top = sorted(((v, k) for k, v in et_counts.items()
                  if k in SLUG_BY_ET and v), reverse=True)[:3]
    breakdown = "、".join(f"{k} {v:,} 个" for v, k in ((v, k) for v, k in top))
    month_txt = f"本月{scope}新增 {month_new:,} 个岗位。" if month_new else ""
    body = (f"{scope}当前在库体制内岗位共 {total:,} 个。{month_txt}"
            + (f"其中数量最多的类型为：{breakdown}。" if breakdown else "")
            + "数据来自各级人事考试网、事业单位招聘公告等官方公开渠道，去重后每日更新，"
              "点击岗位类型可查看对应报名时间与学历要求明细。")
    return f"<p class='desc'>{body}</p>"


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


@cache.cached("seo_index", ttl=SEO_TTL, stale=True)
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


@cache.cached("seo_prov", ttl=SEO_TTL, stale=True)
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
    month_new = (_active(db.query(func.count()).select_from(Position))
                 .filter(Position.province == prov,
                         Position.created_at >= _month_start()).scalar() or 0)
    chips = "".join(
        f"<a href='/zhaokao/{slug}/{et_slug}'>{short}<span class='n'>{et_counts.get(norm, 0):,}</span></a>"
        for et_slug, norm, short in EXAM_TYPES)
    city_chips = "".join(
        f"<a href='/zhaokao/{slug}/{c}'>{n}</a>"
        for c, n in CITIES_BY_PROV.get(slug, []))
    city_section = (
        f"<h2 style='font-size:16px;margin:16px 0 8px'>热门城市</h2>"
        f"<div class='chips'>{city_chips}</div>") if city_chips else ""
    others = "".join(
        f"<a href='/zhaokao/{s}'>{n}</a>" for s, n in PROVINCES if s != slug)
    body = (f"<h1>{prov}公务员·事业单位招考岗位</h1>"
            + _stats_para(prov, total, month_new, et_counts)
            + f"<div class='chips'>{chips}</div>"
            + city_section
            + f"<a class='cta' href='/?province={quote(prov)}'>在{BRAND}中筛选{prov}全部岗位 →</a>"
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


@cache.cached("seo_prov_et", ttl=SEO_TTL, stale=True)
def _render_province_et(slug: str, et_slug: str, db: Session = None) -> str:
    prov = PROV_BY_SLUG[slug]
    et_norm, short = ET_BY_SLUG[et_slug]
    q = _active(db.query(Position)).filter(
        Position.province == prov, Position.exam_type_norm == et_norm)
    db.execute(text("SET statement_timeout = '120s'"))  # 大省×类型全量计数超默认超时
    total = q.count()
    jobs = q.order_by(Position.id.desc()).limit(50).all()
    db.execute(text("SET statement_timeout = DEFAULT"))
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


@cache.cached("seo_city", ttl=SEO_TTL, stale=True)
def _render_city(slug: str, city_slug: str, db: Session = None) -> str:
    prov = PROV_BY_SLUG[slug]
    city = CITY_BY_SLUG[(slug, city_slug)]
    et_counts = dict(
        _active(db.query(Position.exam_type_norm, func.count()))
        .filter(Position.province == prov, Position.city == city)
        .group_by(Position.exam_type_norm).all())
    total = sum(et_counts.values())
    month_new = (_active(db.query(func.count()).select_from(Position))
                 .filter(Position.province == prov, Position.city == city,
                         Position.created_at >= _month_start()).scalar() or 0)
    jobs = (_active(db.query(Position))
            .filter(Position.province == prov, Position.city == city)
            .order_by(Position.id.desc()).limit(30).all())
    chips = "".join(
        f"<a href='/zhaokao/{slug}/{city_slug}/{et_slug}'>{short}"
        f"<span class='n'>{et_counts.get(norm, 0):,}</span></a>"
        for et_slug, norm, short in EXAM_TYPES if et_counts.get(norm, 0))
    siblings = "".join(
        f"<a href='/zhaokao/{slug}/{c}'>{n}</a>"
        for c, n in CITIES_BY_PROV.get(slug, []) if c != city_slug)
    sib_section = (
        f"<h2 style='font-size:16px;margin:20px 0 8px'>{prov}其他城市</h2>"
        f"<div class='chips'>{siblings}</div>") if siblings else ""
    deep = f"/?province={quote(prov)}&location={quote(city)}"
    body = (f"<h1>{city}公务员·事业单位招考岗位</h1>"
            + _stats_para(f"{prov}{city}" if prov != city else city, total, month_new, et_counts)
            + (f"<div class='chips'>{chips}</div>" if chips else "")
            + f"<a class='cta' href='{_esc(deep)}'>在{BRAND}中筛选{city}全部岗位 →</a>"
            f"<h2 style='font-size:16px;margin:16px 0 8px'>最新岗位</h2>"
            f"<table><thead><tr><th>岗位</th><th>单位</th><th>地点</th><th>学历</th><th>报名时间</th></tr></thead>"
            f"<tbody>{_job_rows(jobs)}</tbody></table>"
            + sib_section
            + f"<h2 style='font-size:16px;margin:20px 0 8px'>所属省份</h2>"
            f"<div class='chips'><a href='/zhaokao/{slug}'>{prov}全部岗位</a></div>")
    crumb = (f"<a href='/'>{BRAND}</a> › <a href='/zhaokao'>招考岗位</a> › "
             f"<a href='/zhaokao/{slug}'>{prov}</a> › {city}")
    return _page(f"{city}公务员事业单位招考岗位（{total:,} 个在招） - {BRAND}",
                 f"{city}最新公务员、事业单位、选调生、教师、医疗招考岗位 {total:,} 个，含报名时间与学历要求，每日更新。",
                 f"{SITE}/zhaokao/{slug}/{city_slug}", crumb, body,
                 _jsonld(jobs, prov, "招考"))


@cache.cached("seo_city_et", ttl=SEO_TTL, stale=True)
def _render_city_et(slug: str, city_slug: str, et_slug: str, db: Session = None) -> str:
    prov = PROV_BY_SLUG[slug]
    city = CITY_BY_SLUG[(slug, city_slug)]
    et_norm, short = ET_BY_SLUG[et_slug]
    q = _active(db.query(Position)).filter(
        Position.province == prov, Position.city == city,
        Position.exam_type_norm == et_norm)
    total = q.count()
    month_new = (_active(db.query(func.count()).select_from(Position))
                 .filter(Position.province == prov, Position.city == city,
                         Position.exam_type_norm == et_norm,
                         Position.created_at >= _month_start()).scalar() or 0)
    jobs = q.order_by(Position.id.desc()).limit(50).all()
    siblings = "".join(
        f"<a href='/zhaokao/{slug}/{city_slug}/{s}'>{sh}</a>"
        for s, _, sh in EXAM_TYPES if s != et_slug)
    deep = f"/?province={quote(prov)}&location={quote(city)}&exam_type_norm={quote(et_norm)}"
    body = (f"<h1>{city}{short}岗位（{total:,} 个在库）</h1>"
            + _stats_para(f"{city}{short}", total, month_new, {et_norm: total})
            + f"<a class='cta' href='{_esc(deep)}'>在{BRAND}中筛选与订阅 →</a>"
            f"<table><thead><tr><th>岗位</th><th>单位</th><th>地点</th><th>学历</th><th>报名时间</th></tr></thead>"
            f"<tbody>{_job_rows(jobs)}</tbody></table>"
            f"<h2 style='font-size:16px;margin:20px 0 8px'>{city}其他类型</h2>"
            f"<div class='chips'>{siblings}</div>"
            f"<h2 style='font-size:16px;margin:20px 0 8px'>更多</h2>"
            f"<div class='chips'><a href='/zhaokao/{slug}/{city_slug}'>{city}全部岗位</a>"
            f"<a href='/zhaokao/{slug}/{et_slug}'>{prov}{short}</a></div>")
    crumb = (f"<a href='/'>{BRAND}</a> › <a href='/zhaokao'>招考岗位</a> › "
             f"<a href='/zhaokao/{slug}'>{prov}</a> › "
             f"<a href='/zhaokao/{slug}/{city_slug}'>{city}</a> › {short}")
    return _page(f"{city}{short}岗位招录（{total:,} 个） - {BRAND}",
                 f"{city}最新{et_norm}岗位 {total:,} 个：单位、工作地点、学历要求、报名时间一览，每日更新。",
                 f"{SITE}/zhaokao/{slug}/{city_slug}/{et_slug}", crumb, body,
                 _jsonld(jobs, prov, et_norm))


# ---------------- 专业反查页 /major ----------------

def _major_positions(db: Session, name: str):
    """体制内岗位的专业命中口径：三个专业字段任一子串命中（见 major_pages）。"""
    like = f"%{name}%"
    return _active(db.query(Position)).filter(or_(
        Position.undergrad_major.ilike(like),
        Position.grad_major.ilike(like),
        Position.raw_major.ilike(like)))


@cache.cached("seo_major_counts", ttl=SEO_TTL, stale=True)
def _major_counts(db: Session = None) -> dict:
    """全部专业的命中统计（slug -> {pos, campus, bianzhi, prov, et}）；只在预热时重算。

    单次全表分组扫描后在 Python 侧做子串匹配，避免逐专业 148×3 次 ILIKE 全表扫描
    （单次约 20s，全量超过 warm 任务 1h 硬限）。
    """
    db.execute(text("SET statement_timeout = '300s'"))  # 仅预热路径承担
    names = [(slug, name) for slug, (name, _d) in MAJOR_BY_SLUG.items()]
    out = {slug: {"pos": 0, "campus": 0, "bianzhi": 0, "prov": {}, "et": {}}
           for slug, _ in names}
    rows = (_active(db.query(Position))
            .with_entities(Position.undergrad_major, Position.grad_major,
                           Position.raw_major, Position.province,
                           Position.exam_type_norm, func.count())
            .group_by(Position.undergrad_major, Position.grad_major,
                      Position.raw_major, Position.province,
                      Position.exam_type_norm))
    for ug, gm, rm, prov, et, n in rows.yield_per(20000):
        blob = f"{ug or ''}\n{gm or ''}\n{rm or ''}"
        for slug, nm in names:
            if nm in blob:
                c = out[slug]
                c["pos"] += n
                if prov:
                    c["prov"][prov] = c["prov"].get(prov, 0) + n
                if et:
                    c["et"][et] = c["et"].get(et, 0) + n
    for model, key in ((CampusJob, "campus"), (BianzhiJob, "bianzhi")):
        rows = (db.query(model.major_requirement, func.count())
                .group_by(model.major_requirement))
        for req, n in rows.yield_per(20000):
            if not req:
                continue
            for slug, nm in names:
                if nm in req:
                    out[slug][key] += n
    db.execute(text("SET statement_timeout = DEFAULT"))
    return out


def _major_live_slugs(db: Session) -> list:
    """有命中岗位的专业 slug 列表（命中不了的专业不出页）。"""
    counts = _major_counts(db=db)
    return [s for s, c in counts.items()
            if c["pos"] + c["campus"] + c["bianzhi"] > 0]


def _major_jsonld(name: str, jobs) -> str:
    postings = []
    for j in jobs[:20]:
        title = (j.position_example or "").strip() or (j.exam_type_norm or "岗位")
        item = {
            "@type": "JobPosting",
            "title": title[:80],
            "hiringOrganization": {"@type": "Organization",
                                   "name": (j.employer or "招录单位")[:80]},
            "jobLocation": {"@type": "Place", "address": {
                "@type": "PostalAddress", "addressRegion": j.province or "全国",
                "addressLocality": j.city or j.province or "全国",
                "addressCountry": "CN"}},
            "employmentType": "FULL_TIME",
            "industry": j.exam_type_norm or "招考",
            "qualifications": f"{name}专业可报",
        }
        if j.created_at:
            item["datePosted"] = j.created_at.strftime("%Y-%m-%d")
        if j.signup_deadline:
            item["validThrough"] = j.signup_deadline.strftime("%Y-%m-%d")
        postings.append(item)
    if not postings:
        return ""
    data = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": f"{name}专业可报岗位",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "item": p}
            for i, p in enumerate(postings)],
    }
    return ("<script type=\"application/ld+json\">"
            + json.dumps(data, ensure_ascii=False) + "</script>")


@cache.cached("seo_major_index", ttl=SEO_TTL, stale=True)
def _render_major_index(db: Session = None) -> str:
    counts = _major_counts(db=db)
    sections = []
    grand = 0
    live = 0
    for disc, majors in MAJOR_DISCIPLINES:
        chips = []
        for slug, name in majors:
            c = counts.get(slug) or {}
            n = (c.get("pos", 0) or 0) + (c.get("campus", 0) or 0) + (c.get("bianzhi", 0) or 0)
            if not n:
                continue
            grand += n
            live += 1
            chips.append(f"<a href='/major/{slug}'>{name}<span class='n'>{n:,}</span></a>")
        if chips:
            sections.append(
                f"<h2 style='font-size:16px;margin:16px 0 8px'>{disc}</h2>"
                f"<div class='chips'>{''.join(chips)}</div>")
    body = (f"<h1>专业能报什么岗位？按专业反查可报岗位</h1>"
            f"<p class='desc'>按你的专业反查全国公务员、事业单位、编制与校招岗位："
            f"收录 {live} 个常见专业、累计 {grand:,} 个专业对口岗位，按学科门类分组，"
            f"点击专业查看各板块岗位数、省份分布、考试类型与最新岗位样例，每日更新。</p>"
            + "".join(sections)
            + f"<a class='cta' href='/'>打开{BRAND}筛选全部岗位 →</a>")
    crumb = f"<a href='/'>{BRAND}</a> › 专业反查"
    jsonld = ("<script type=\"application/ld+json\">" + json.dumps({
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": f"{BRAND}专业反查可报岗位",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1,
             "url": f"{SITE}/major/{slug}",
             "name": f"{MAJOR_BY_SLUG[slug][0]}专业可报岗位"}
            for i, slug in enumerate(_major_live_slugs(db)[:50])],
    }, ensure_ascii=False) + "</script>")
    return _page(f"专业反查可报岗位（公务员·事业单位·校招） - {BRAND}",
                 f"按专业反查可报岗位：计算机、法学、会计、临床医学等 {live} 个常见专业对应的公务员、事业单位、编制与校招岗位数量与最新岗位，每日更新。",
                 f"{SITE}/major", crumb, body, jsonld)


@cache.cached("seo_major", ttl=SEO_TTL, stale=True)
def _render_major(slug: str, db: Session = None) -> str:
    name, disc = MAJOR_BY_SLUG[slug]
    c = _major_counts(db=db).get(slug) or {}
    prov_counts: dict = c.get("prov") or {}
    et_counts: dict = c.get("et") or {}
    pos_total = c.get("pos", 0) or 0
    campus_total = c.get("campus", 0) or 0
    bz_total = c.get("bianzhi", 0) or 0
    if pos_total + campus_total + bz_total == 0:
        raise HTTPException(status_code=404)
    db.execute(text("SET statement_timeout = '120s'"))  # 样例查询仅预热路径承担
    jobs = (_major_positions(db, name)
            .order_by(Position.id.desc()).limit(20).all())
    db.execute(text("SET statement_timeout = DEFAULT"))

    top_prov = sorted(prov_counts.items(), key=lambda kv: -kv[1])[:10]
    prov_chips = "".join(
        f"<a href='/zhaokao/{SLUG_BY_PROV[p]}'>{p}<span class='n'>{n:,}</span></a>"
        for p, n in top_prov if p in SLUG_BY_PROV)
    et_top = sorted(et_counts.items(), key=lambda kv: -kv[1])[:8]
    et_chips = "".join(
        (f"<a href='/?major={quote(name)}&exam_type_norm={quote(et)}'>{et}"
         f"<span class='n'>{n:,}</span></a>") for et, n in et_top)
    board_bits = [f"体制内 {pos_total:,} 个"]
    if campus_total:
        board_bits.append(f"校招/社招 {campus_total:,} 个")
    if bz_total:
        board_bits.append(f"编制/央国企 {bz_total:,} 个")
    top3 = "、".join(f"{et} {n:,} 个" for et, n in et_top[:3])
    desc_txt = (f"{name}专业（{disc}门类）当前全站可报岗位：{'，'.join(board_bits)}。"
                + (f"体制内岗位中数量最多的考试类型为：{top3}。" if top3 else "")
                + "命中口径为岗位专业要求字段包含该专业名（含所属大类表述），"
                  "数据来自各级人事考试网与官方公告，每日更新，实际以官方职位表为准。")
    deep = f"/?major={quote(name)}"
    campus_deep = f"/?board=campus&bkw={quote(name)}"
    others = "".join(
        f"<a href='/major/{s}'>{n}</a>"
        for d2, ms in MAJOR_DISCIPLINES if d2 == disc
        for s, n in ms if s != slug)
    body = (f"<h1>{name}专业能报哪些岗位？</h1>"
            f"<p class='desc'>{desc_txt}</p>"
            + (f"<h2 style='font-size:16px;margin:16px 0 8px'>考试类型分布</h2>"
               f"<div class='chips'>{et_chips}</div>" if et_chips else "")
            + (f"<h2 style='font-size:16px;margin:16px 0 8px'>省份分布 Top10</h2>"
               f"<div class='chips'>{prov_chips}</div>" if prov_chips else "")
            + f"<a class='cta' href='{_esc(deep)}'>在{BRAND}中按「{name}」筛选体制内岗位 →</a> "
            + (f"<a class='cta' style='background:#0f766e' href='{_esc(campus_deep)}'>查看{name}校招岗位 →</a>" if campus_total else "")
            + f"<h2 style='font-size:16px;margin:16px 0 8px'>最新岗位样例</h2>"
            f"<table><thead><tr><th>岗位</th><th>单位</th><th>地点</th><th>学历</th><th>报名时间</th></tr></thead>"
            f"<tbody>{_job_rows(jobs)}</tbody></table>"
            + (f"<h2 style='font-size:16px;margin:20px 0 8px'>{disc}门类其他专业</h2>"
               f"<div class='chips'>{others}</div>" if others else "")
            + "<h2 style='font-size:16px;margin:20px 0 8px'>更多</h2>"
            "<div class='chips'><a href='/major'>全部专业反查</a>"
            "<a href='/zhaokao'>按省份浏览岗位</a></div>")
    crumb = (f"<a href='/'>{BRAND}</a> › <a href='/major'>专业反查</a> › {name}")
    total_all = pos_total + campus_total + bz_total
    return _page(f"{name}专业能报哪些岗位（{total_all:,} 个在库） - {BRAND}",
                 f"{name}专业可报岗位 {total_all:,} 个：公务员、事业单位、编制与校招岗位数量、省份分布、考试类型与最新岗位样例，每日更新。",
                 f"{SITE}/major/{slug}", crumb, body,
                 _major_jsonld(name, jobs))


@router.get("/major", response_class=HTMLResponse)
def major_index(db: Session = Depends(get_db)):
    return _html(_render_major_index(db=db))


@router.get("/major/{slug}", response_class=HTMLResponse)
def major_detail(slug: str, db: Session = Depends(get_db)):
    if slug not in MAJOR_BY_SLUG:
        canonical = resolve_major_alias(slug)
        if canonical:
            return RedirectResponse(f"/major/{canonical}", status_code=301)
        raise HTTPException(status_code=404)
    return _html(_render_major(slug, db=db))


@router.get("/zhaokao", response_class=HTMLResponse)
def seo_index(db: Session = Depends(get_db)):
    return _html(_render_index(db=db))


@router.get("/zhaokao/{slug}", response_class=HTMLResponse)
def seo_province(slug: str, db: Session = Depends(get_db)):
    if slug not in PROV_BY_SLUG:
        raise HTTPException(status_code=404)
    return _html(_render_province(slug, db=db))


@router.get("/zhaokao/{slug}/{sub}", response_class=HTMLResponse)
def seo_province_sub(slug: str, sub: str, db: Session = Depends(get_db)):
    """第二段既可能是考试类型（/zhaokao/guangdong/shengkao），也可能是城市
    （/zhaokao/guangdong/shenzhen）。"""
    if slug not in PROV_BY_SLUG:
        raise HTTPException(status_code=404)
    if sub in ET_BY_SLUG:
        return _html(_render_province_et(slug, sub, db=db))
    if (slug, sub) in CITY_BY_SLUG:
        return _html(_render_city(slug, sub, db=db))
    raise HTTPException(status_code=404)


@router.get("/zhaokao/{slug}/{city_slug}/{et_slug}", response_class=HTMLResponse)
def seo_city_et(slug: str, city_slug: str, et_slug: str, db: Session = Depends(get_db)):
    if (slug, city_slug) not in CITY_BY_SLUG or et_slug not in ET_BY_SLUG:
        raise HTTPException(status_code=404)
    return _html(_render_city_et(slug, city_slug, et_slug, db=db))


# ---------------- 每日精选栏目页 /daily ----------------

def _fmt_day_cn(d: date) -> str:
    return d.strftime("%Y年%m月%d日")


def _daily_deadline(deadline_date, deadline_text) -> str:
    if deadline_date:
        return deadline_date.strftime("%m月%d日")
    t = (deadline_text or "").strip()
    return t[:20] if t else "详见公告"


@cache.cached("seo_daily_days", ttl=1800, stale=True)
def _recent_digest_days(db: Session = None, limit: int = 90) -> list:
    """最近期号日期字符串列表（YYYY-MM-DD，倒序；缓存友好）。"""
    rows = (db.query(DailyDigest.day)
            .order_by(DailyDigest.day.desc()).limit(limit).all())
    return [r[0].isoformat() for r in rows]


@cache.cached("seo_daily_index", ttl=SEO_TTL, stale=True)
def _render_daily_index(db: Session = None) -> str:
    rows = (db.query(DailyDigest)
            .order_by(DailyDigest.day.desc()).limit(90).all())
    items = []
    for r in rows:
        n = len(json.loads(r.campus_ids_json or "[]")) + len(json.loads(r.bianzhi_ids_json or "[]"))
        d = r.day.isoformat()
        items.append(
            f"<tr><td data-l='期号'><a href='/daily/{d}'>每日岗位精选 · {_fmt_day_cn(r.day)}</a></td>"
            f"<td data-l='岗位数'>{n} 个精选岗位</td></tr>")
    body = (f"<h1>每日岗位精选</h1>"
            f"<p class='desc'>上岸雷达每天从当日新收录的校招/社招与编制/央国企岗位中，"
            f"精选高价值岗位成期发布：覆盖央企国企、外企、事业单位、教师医疗等方向，"
            f"含单位、地点与报名截止时间，共 {len(items)} 期，每日更新。</p>"
            f"<table><thead><tr><th>期号</th><th>岗位数</th></tr></thead>"
            f"<tbody>{''.join(items)}</tbody></table>"
            f"<a class='cta' href='/'>打开{BRAND}筛选全部岗位 →</a>")
    crumb = f"<a href='/'>{BRAND}</a> › 每日精选"
    jsonld = ("<script type=\"application/ld+json\">" + json.dumps({
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": f"{BRAND}每日岗位精选",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1,
             "url": f"{SITE}/daily/{r.day.isoformat()}",
             "name": f"每日岗位精选 · {_fmt_day_cn(r.day)}"}
            for i, r in enumerate(rows[:30])],
    }, ensure_ascii=False) + "</script>")
    return _page(f"每日岗位精选（校招·编制·央国企） - {BRAND}",
                 "上岸雷达每日岗位精选：每天从新收录岗位中精选央企国企、外企、事业单位、教师医疗等高价值岗位，含截止时间，按期归档。",
                 f"{SITE}/daily", crumb, body, jsonld)


def _daily_jsonld(day: date, campus, bianzhi) -> str:
    postings = []
    for j in campus:
        item = {
            "@type": "JobPosting",
            "title": ((j.positions or "").replace("\n", " ").strip() or "校园招聘")[:80],
            "hiringOrganization": {"@type": "Organization", "name": (j.company or "招聘单位")[:80]},
            "jobLocation": {"@type": "Place", "address": {
                "@type": "PostalAddress",
                "addressLocality": ((j.locations or "").split("、")[0].split(",")[0] or "多地")[:20],
                "addressCountry": "CN"}},
            "employmentType": "FULL_TIME",
            "datePosted": day.isoformat(),
        }
        if j.deadline_date:
            item["validThrough"] = j.deadline_date.strftime("%Y-%m-%d")
        postings.append(item)
    for j in bianzhi:
        item = {
            "@type": "JobPosting",
            "title": ((j.employer or "").replace("\n", " ").strip() or "编制岗位")[:80],
            "hiringOrganization": {"@type": "Organization", "name": (j.employer or "招录单位")[:80]},
            "jobLocation": {"@type": "Place", "address": {
                "@type": "PostalAddress", "addressRegion": j.province or "全国",
                "addressCountry": "CN"}},
            "employmentType": "FULL_TIME",
            "industry": j.category or "编制招聘",
            "datePosted": day.isoformat(),
        }
        if j.deadline_date:
            item["validThrough"] = j.deadline_date.strftime("%Y-%m-%d")
        postings.append(item)
    data = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": f"每日岗位精选 · {_fmt_day_cn(day)}",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "item": p}
            for i, p in enumerate(postings)],
    }
    return ("<script type=\"application/ld+json\">"
            + json.dumps(data, ensure_ascii=False) + "</script>")


@cache.cached("seo_daily_detail", ttl=SEO_TTL, stale=True)
def _render_daily_detail(day_str: str, db: Session = None) -> str:
    day = date.fromisoformat(day_str)
    row = db.query(DailyDigest).filter(DailyDigest.day == day).first()
    if row is None:
        raise HTTPException(status_code=404)
    campus_ids = json.loads(row.campus_ids_json or "[]")
    bianzhi_ids = json.loads(row.bianzhi_ids_json or "[]")
    campus = (db.query(CampusJob).filter(CampusJob.id.in_(campus_ids)).all()
              if campus_ids else [])
    campus.sort(key=lambda r: campus_ids.index(r.id))
    bianzhi = (db.query(BianzhiJob).filter(BianzhiJob.id.in_(bianzhi_ids)).all()
               if bianzhi_ids else [])
    bianzhi.sort(key=lambda r: bianzhi_ids.index(r.id))

    sections = []
    if campus:
        rows_html = "".join(
            f"<tr><td data-l='岗位'><a href='/?board=campus&job=campus:{j.id}'>"
            f"{_esc(((j.positions or '').replace(chr(10), ' ') or '校园招聘')[:40])}</a></td>"
            f"<td data-l='单位'>{_esc((j.company or '')[:30])}</td>"
            f"<td data-l='地点'>{_esc(((j.locations or '').split('、')[0].split(',')[0] or '多地')[:14])}</td>"
            f"<td data-l='截止'>{_esc(_daily_deadline(j.deadline_date, j.deadline_text))}</td></tr>"
            for j in campus)
        sections.append(
            f"<h2 style='font-size:16px;margin:16px 0 8px'>校招/社招精选（{len(campus)} 个）</h2>"
            f"<table><thead><tr><th>岗位</th><th>单位</th><th>地点</th><th>截止</th></tr></thead>"
            f"<tbody>{rows_html}</tbody></table>")
    if bianzhi:
        rows_html = "".join(
            f"<tr><td data-l='单位'><a href='/?board=bianzhi&bpreset=all&job=bianzhi:{j.id}'>"
            f"{_esc(((j.employer or '').replace(chr(10), ' ') or '编制岗位')[:36])}</a></td>"
            f"<td data-l='类别'>{_esc((j.category or '')[:16])}</td>"
            f"<td data-l='地区'>{_esc((j.province or '')[:10])}</td>"
            f"<td data-l='截止'>{_esc(_daily_deadline(j.deadline_date, j.deadline_text))}</td></tr>"
            for j in bianzhi)
        sections.append(
            f"<h2 style='font-size:16px;margin:16px 0 8px'>编制/央国企精选（{len(bianzhi)} 个）</h2>"
            f"<table><thead><tr><th>单位</th><th>类别</th><th>地区</th><th>截止</th></tr></thead>"
            f"<tbody>{rows_html}</tbody></table>")

    days = _recent_digest_days(db=db, limit=14)
    others = "".join(
        f"<a href='/daily/{d}'>{int(d[5:7])}月{int(d[8:10])}日</a>"
        for d in days if d != day_str)
    total = len(campus) + len(bianzhi)
    body = (f"<h1>每日岗位精选 · {_fmt_day_cn(day)}</h1>"
            f"<p class='desc'>{_esc(row.intro)}</p>"
            + "".join(sections)
            + f"<a class='cta' href='/'>打开{BRAND}筛选与订阅全部岗位 →</a>"
            f"<h2 style='font-size:16px;margin:20px 0 8px'>近期精选</h2>"
            f"<div class='chips'>{others}<a href='/daily'>全部期号</a></div>")
    crumb = (f"<a href='/'>{BRAND}</a> › <a href='/daily'>每日精选</a> › "
             f"{_fmt_day_cn(day)}")
    return _page(f"每日岗位精选 {_fmt_day_cn(day)}（{total} 个高价值岗位） - {BRAND}",
                 f"{_fmt_day_cn(day)}上岸雷达精选 {total} 个高价值岗位：校招/社招 {len(campus)} 个、编制/央国企 {len(bianzhi)} 个，含单位、地点与报名截止时间。",
                 f"{SITE}/daily/{day.isoformat()}", crumb, body,
                 _daily_jsonld(day, campus, bianzhi))


@router.get("/daily", response_class=HTMLResponse)
def daily_index(db: Session = Depends(get_db)):
    return _html(_render_daily_index(db=db))


@router.get("/daily/{day_str}", response_class=HTMLResponse)
def daily_detail(day_str: str, db: Session = Depends(get_db)):
    try:
        date.fromisoformat(day_str)
    except ValueError:
        raise HTTPException(status_code=404)
    return _html(_render_daily_detail(day_str, db=db))


@router.get("/api/daily/latest")
def daily_latest(db: Session = Depends(get_db)):
    """SPA「今日精选」入口：返回最新一期期号（仅当日有期号时返回 today）。"""
    row = (db.query(DailyDigest)
           .order_by(DailyDigest.day.desc()).first())
    if row is None:
        return {"day": None, "is_today": False}
    today = datetime.now(timezone(timedelta(hours=8))).date()
    return {"day": row.day.isoformat(), "is_today": row.day >= today}


# IndexNow 站点验证密钥文件（https://www.indexnow.org/）：仅在配置了密钥时注册精确路径，
# 避免动态 /{key}.txt 模式截获 robots.txt 等静态文件
INDEXNOW_KEY = os.environ.get("INDEXNOW_KEY", "")

if INDEXNOW_KEY:
    @router.get(f"/{INDEXNOW_KEY}.txt", response_class=PlainTextResponse, include_in_schema=False)
    def indexnow_key():
        return PlainTextResponse(INDEXNOW_KEY)


@cache.cached("seo_city_ets", ttl=6 * 3600, stale=True)
def _city_et_slugs(db: Session = None) -> list:
    """sitemap 用：仅收录岗位数 >0 的 城市×类型 组合，避免产出空薄页。"""
    rows = (_active(db.query(Position.province, Position.city,
                             Position.exam_type_norm, func.count()))
            .filter(Position.city.isnot(None), Position.exam_type_norm.isnot(None))
            .group_by(Position.province, Position.city, Position.exam_type_norm)
            .all())
    by_pc = {(SLUG_BY_PROV.get(p), c): {} for p, c, _, _ in rows}
    for p, c, et, n in rows:
        ps = SLUG_BY_PROV.get(p)
        if ps and n:
            by_pc[(ps, c)][et] = n
    out = []
    for (ps, cs, city) in CITIES:
        ets = by_pc.get((ps, city), {})
        for et_slug, norm, _ in EXAM_TYPES:
            if ets.get(norm):
                out.append(f"{ps}/{cs}/{et_slug}")
    return out


@router.get("/sitemap.xml")
def sitemap(db: Session = Depends(get_db)):
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
        url(f"{SITE}/daily", "0.9"),
        url(f"{SITE}/major", "0.9"),
    ]
    try:
        for s in _major_live_slugs(db):
            urls.append(url(f"{SITE}/major/{s}", "0.7"))
    except Exception:
        pass  # 专业页枚举失败不影响 sitemap 主体
    try:
        for d in _recent_digest_days(db=db):
            urls.append(url(f"{SITE}/daily/{d}", "0.7"))
    except Exception:
        pass  # 精选期号枚举失败不影响 sitemap 主体
    for slug, _ in PROVINCES:
        urls.append(url(f"{SITE}/zhaokao/{slug}", "0.8"))
        for et_slug, _, _ in EXAM_TYPES:
            urls.append(url(f"{SITE}/zhaokao/{slug}/{et_slug}", "0.7"))
    for ps, cs, _ in CITIES:
        urls.append(url(f"{SITE}/zhaokao/{ps}/{cs}", "0.7"))
    try:
        for path in _city_et_slugs(db=db):
            urls.append(url(f"{SITE}/zhaokao/{path}", "0.6"))
    except Exception:
        pass  # 组合枚举失败不影响 sitemap 主体
    xml = ("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
           "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"
           + "".join(urls) + "</urlset>")
    return Response(content=xml, media_type="application/xml")
