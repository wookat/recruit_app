# -*- coding: utf-8 -*-
"""R301 单测：bot_crawl 解析/分类/聚合（无 DB 依赖）。

用法: cd backend && python tests/test_bot_crawl.py
"""
import json
import os
import sys
import tempfile
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bot_crawl
from bot_crawl import CN_TZ, aggregate_day, classify_bot, path_family


def test_classify():
    assert classify_bot("Mozilla/5.0 (compatible; Googlebot/2.1)", "66.249.66.1") == "googlebot"
    assert classify_bot("Mozilla/5.0 (compatible; Googlebot/2.1)", "1.2.3.4") == "googlebot?"
    assert classify_bot("Mozilla/5.0 (compatible; bingbot/2.0)", "157.55.39.1") == "bingbot"
    assert classify_bot("Baiduspider/2.0", "220.181.108.1") == "baiduspider"
    assert classify_bot("python-requests/2.31", "9.9.9.9") == "other-bot"
    assert classify_bot("Mozilla/5.0 (Windows NT 10.0) Chrome/126", "9.9.9.9") is None
    assert classify_bot("", "1.1.1.1") is None
    print("classify ok")


def test_path_family():
    assert path_family("/") == "home"
    assert path_family("/?qa=1") == "home"
    assert path_family("/zhaokao/guangdong/shenzhen") == "zhaokao"
    assert path_family("/major/computer") == "major"
    assert path_family("/daily/2026-08-07") == "daily"
    assert path_family("/sitemap-1.xml") == "seo-meta"
    assert path_family("/robots.txt") == "seo-meta"
    assert path_family("/api/positions?page=1") == "api"
    assert path_family("/assets/index-abc.js") == "static"
    assert path_family("/whatever") == "other"
    print("path_family ok")


def _entry(ts, ua, ip, uri, status):
    return json.dumps({
        "ts": ts, "status": status,
        "request": {"remote_ip": ip, "uri": uri,
                    "headers": {"User-Agent": [ua]}},
    })


def test_aggregate():
    day = date(2026, 8, 7)
    ts_in = datetime(2026, 8, 7, 12, 0, tzinfo=CN_TZ).timestamp()
    ts_out = datetime(2026, 8, 8, 12, 0, tzinfo=CN_TZ).timestamp()
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, f"{bot_crawl.CADDY_LOG_BASENAME}.log"), "w") as f:
            f.write(_entry(ts_in, "Googlebot/2.1", "66.249.1.1", "/zhaokao/x", 200) + "\n")
            f.write(_entry(ts_in, "Googlebot/2.1", "66.249.1.1", "/zhaokao/y", 404) + "\n")
            f.write(_entry(ts_in, "Chrome/126", "8.8.8.8", "/", 200) + "\n")  # 非 bot
            f.write(_entry(ts_out, "Googlebot/2.1", "66.249.1.1", "/", 200) + "\n")  # 跨日
            f.write("not-json\n")
        agg = aggregate_day(day, log_dir=d)
    assert agg == {("googlebot", "zhaokao"): [2, 1, 1, 0]}, agg
    print("aggregate ok")


if __name__ == "__main__":
    test_classify()
    test_path_family()
    test_aggregate()
    print("all ok")
