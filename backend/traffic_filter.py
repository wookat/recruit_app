"""服务端 QA/内部流量识别：UA 关键词 + 云厂商 IP 段 + 显式 qa 标记。

metrics 上报请求先经此模块判定 internal，命中则落库时标记 internal=true
（保留行但不计入统计口径）。CIDR 列表在 data/cloud_cidrs.txt 维护，可随时更新。
"""

import hashlib
import ipaddress
import os
import re
from functools import lru_cache

from fastapi import Request

#: 无头浏览器 / 自动化 / 爬虫 UA 关键词（大小写不敏感）
BOT_UA_RE = re.compile(
    r"headless|bot|crawl|spider|slurp|curl|wget|python|httpx|aiohttp|scrapy"
    r"|playwright|puppeteer|selenium|phantomjs|uptime|censys|monitor|pingdom",
    re.IGNORECASE,
)

_CIDR_FILE = os.path.join(os.path.dirname(__file__), "data", "cloud_cidrs.txt")

#: ip 哈希盐（仅用于去标识化，不要求保密强度）
_IP_HASH_SALT = os.environ.get("METRICS_IP_SALT", "recruit-metrics-v1")


@lru_cache(maxsize=1)
def _load_cloud_networks() -> tuple:
    nets = []
    try:
        with open(_CIDR_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.split("#", 1)[0].strip()
                if not line:
                    continue
                try:
                    nets.append(ipaddress.ip_network(line, strict=False))
                except ValueError:
                    continue
    except OSError:
        pass
    return tuple(nets)


def is_cloud_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _load_cloud_networks())


def get_client_ip(request: Request) -> str:
    ip = request.headers.get("cf-connecting-ip")
    if ip:
        return ip.strip()
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


def hash_ip(ip: str) -> str:
    """ip 去标识化存储：加盐 sha256 截断，仅用于同源聚合/审计，不可逆推。"""
    if not ip:
        return ""
    return hashlib.sha256(f"{_IP_HASH_SALT}:{ip}".encode()).hexdigest()[:16]


def classify_request(request: Request, qa: bool = False) -> tuple:
    """返回 (internal, ip_hash, ua)。internal 命中任一信号即 true。

    信号：显式 qa 标记（?qa=1 机制保留）、UA 含无头/bot 关键词、IP 属云厂商段。
    """
    ua = (request.headers.get("user-agent") or "")[:300]
    ip = get_client_ip(request)
    internal = bool(qa) or bool(BOT_UA_RE.search(ua)) or is_cloud_ip(ip)
    return internal, hash_ip(ip), ua
