"""Caddy access log 的 bot 抓取观测解析（R301）。

每日 Celery 任务解析前一日（北京时间）JSON access log，按
(day, bot, path_family) 聚合命中数与状态码分布，落库 bot_crawl_daily，
使抓取趋势不受日志滚动窗口（50MB×10 / 14 天）限制。

bot 验真简化为 UA 特征 + 官方 IP 前缀白名单：UA 命中但 IP 不在
已知前缀内的记为 "<bot>?"（存疑，可能是伪装 UA）。前缀列表为粗粒度
运营口径，不追求穷尽，只用于区分「大概率官方」与「伪装/未知」。
"""

import gzip
import json
import os
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

CN_TZ = ZoneInfo("Asia/Shanghai")

CADDY_LOG_DIR = os.getenv("CADDY_LOG_DIR", "/var/log/caddy")
CADDY_LOG_BASENAME = "jobs.zalize.com-access"

#: (bot 名, UA 正则, 官方 IP 前缀元组；空元组=不验真)
BOT_RULES = [
    ("googlebot", re.compile(r"googlebot|google-inspectiontool", re.I),
     ("66.249.", "192.178.")),
    ("bingbot", re.compile(r"bingbot|bingpreview", re.I),
     ("40.77.", "157.55.", "207.46.", "13.66.", "52.167.")),
    ("baiduspider", re.compile(r"baiduspider", re.I),
     ("116.179.", "220.181.", "123.125.", "111.206.")),
    ("bytespider", re.compile(r"bytespider", re.I),
     ("110.249.", "111.225.", "220.243.")),
    ("sogou", re.compile(r"sogou\s*(web\s*)?spider", re.I),
     ("106.38.", "106.120.", "123.126.", "49.7.")),
    ("360spider", re.compile(r"360spider|haosouspider", re.I),
     ("180.153.", "101.226.", "36.110.")),
    ("yandexbot", re.compile(r"yandex(bot|images|mobilebot)", re.I),
     ("5.255.", "77.88.", "87.250.", "213.180.", "95.108.", "141.8.")),
    ("duckduckbot", re.compile(r"duckduck(bot|go)", re.I), ()),
    ("applebot", re.compile(r"applebot", re.I), ("17.",)),
    ("gptbot", re.compile(r"gptbot|oai-searchbot|chatgpt-user", re.I), ()),
    ("claudebot", re.compile(r"claudebot|anthropic", re.I), ()),
    ("perplexitybot", re.compile(r"perplexitybot", re.I), ()),
    ("ahrefsbot", re.compile(r"ahrefsbot", re.I), ()),
    ("semrushbot", re.compile(r"semrushbot", re.I), ()),
    ("mj12bot", re.compile(r"mj12bot", re.I), ()),
    ("petalbot", re.compile(r"petalbot", re.I), ()),
    ("facebookbot", re.compile(r"facebookexternalhit|facebookbot|meta-externalagent", re.I), ()),
]

#: 兜底：任何含通用爬虫关键词但未命中具体规则的 UA
GENERIC_BOT_RE = re.compile(
    r"bot|crawl|spider|slurp|curl|wget|python-requests|httpx|aiohttp|scrapy"
    r"|headless|phantomjs|censys|zgrab|nmap|masscan",
    re.I,
)


def classify_bot(ua: str, ip: str) -> str | None:
    """返回 bot 名（IP 未验真加 "?" 后缀）；非 bot 返回 None。"""
    if not ua:
        return None
    for name, pat, prefixes in BOT_RULES:
        if pat.search(ua):
            if prefixes and not any(ip.startswith(p) for p in prefixes):
                return f"{name}?"
            return name
    if GENERIC_BOT_RE.search(ua):
        return "other-bot"
    return None


def path_family(path: str) -> str:
    """URL 路径归并到有限族，控制 bot_crawl_daily 基数。"""
    p = (path or "/").split("?", 1)[0]
    if p == "/" or p == "/index.html":
        return "home"
    if p.startswith("/assets/") or p in ("/favicon.ico", "/favicon.svg", "/manifest.webmanifest", "/sw.js"):
        return "static"
    if p in ("/robots.txt", "/sitemap.xml") or p.startswith("/sitemap"):
        return "seo-meta"
    if p == "/feed.xml":
        return "feed"
    for fam in ("zhaokao", "major", "topic", "daily", "rank"):
        if p == f"/{fam}" or p.startswith(f"/{fam}/"):
            return fam
    if p.startswith("/api/"):
        return "api"
    return "other"


def _client_ip(entry: dict) -> str:
    req = entry.get("request") or {}
    headers = req.get("headers") or {}
    for h in ("Cf-Connecting-Ip", "X-Forwarded-For"):
        v = headers.get(h)
        if v:
            return str(v[0]).split(",")[0].strip()
    return str(req.get("client_ip") or req.get("remote_ip") or "")


def _ua(entry: dict) -> str:
    headers = (entry.get("request") or {}).get("headers") or {}
    v = headers.get("User-Agent")
    return str(v[0]) if v else ""


def iter_log_files(log_dir: str = CADDY_LOG_DIR) -> list:
    """当前 + 已滚动的 access log（caddy roll 产物形如 <base>-<ts>.log[.gz]）。"""
    try:
        names = os.listdir(log_dir)
    except OSError:
        return []
    return sorted(
        os.path.join(log_dir, n) for n in names
        if n.startswith(CADDY_LOG_BASENAME) and (n.endswith(".log") or n.endswith(".log.gz"))
    )


def aggregate_day(day: date, log_dir: str = CADDY_LOG_DIR) -> dict:
    """解析 access log，返回 {(bot, path_family): [hits, s2xx, s4xx, s5xx]}。

    day 为北京时间自然日；跨文件扫描（当前文件+滚动历史），按 ts 过滤。
    """
    start = datetime(day.year, day.month, day.day, tzinfo=CN_TZ).timestamp()
    end = start + 86400
    agg: dict = {}
    for fp in iter_log_files(log_dir):
        opener = gzip.open if fp.endswith(".gz") else open
        try:
            with opener(fp, "rt", encoding="utf-8", errors="replace") as f:
                for line in f:
                    try:
                        entry = json.loads(line)
                    except ValueError:
                        continue
                    ts = entry.get("ts")
                    if not isinstance(ts, (int, float)) or not (start <= ts < end):
                        continue
                    bot = classify_bot(_ua(entry), _client_ip(entry))
                    if not bot:
                        continue
                    fam = path_family((entry.get("request") or {}).get("uri") or "")
                    row = agg.setdefault((bot, fam), [0, 0, 0, 0])
                    row[0] += 1
                    status = int(entry.get("status") or 0)
                    if 200 <= status < 300:
                        row[1] += 1
                    elif 400 <= status < 500:
                        row[2] += 1
                    elif status >= 500:
                        row[3] += 1
        except OSError:
            continue
    return agg


def yesterday_cn() -> date:
    return (datetime.now(CN_TZ) - timedelta(days=1)).date()
