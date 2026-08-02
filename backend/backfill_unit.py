"""回填 positions.employer（招考单位）——只取源站真实值，不伪造。

两类可恢复的空单位（质量扫描 pos_empty_employer）：
1. xduim 省考职位表（如江西）：源表「部门名称」列此前未在列映射里，按 职位代码 回填。
2. zw.zgsydw.com 事业单位岗位：列表接口 zkdw 为空，但详情页「招考单位/主管部门」有值，
   逐条抓详情页回填（限流，可 --limit 分批跑，幂等）。

xduim 优先读仓库内离线映射 data/xduim_unit_map.json.gz（服务器访问不了源站时也能回填），
无映射文件或缺省份时再尝试在线抓取。

用法（服务器）：
    python backfill_unit.py                # 先 xduim 再 zgsydw 全量
    python backfill_unit.py xduim          # 只回填 xduim 省考
    python backfill_unit.py zgsydw --limit 2000   # zgsydw 分批
"""
import argparse
import gzip
import json
import os
import re
import time

import requests
from sqlalchemy import func

from database import SessionLocal
from models import Position
import scrape_xduim_shengkao as xduim

BATCH = 500
UNIT_MAP_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "xduim_unit_map.json.gz")
_BLANK = (Position.employer.is_(None)) | (func.trim(Position.employer) == "")
_VALID = Position.dup_of_id.is_(None) & Position.invalid_reason.is_(None)

# 主管部门尾部的机构代码，如「解放军总医院第八医学中心(D262026)」
_ORG_CODE_RE = re.compile(r"[（(][A-Z]\d{5,}[)）]\s*$")


def _load_unit_map() -> dict:
    """仓库内离线映射：{province_pinyin: {职位代码: 单位名}}。"""
    if not os.path.exists(UNIT_MAP_PATH):
        return {}
    with gzip.open(UNIT_MAP_PATH, "rt", encoding="utf-8") as f:
        return json.load(f)


def _fetch_online_map(pinyin: str) -> dict:
    """在线抓取省考页面构建 职位代码→单位 映射（源站可达时用）。"""
    years_cities = xduim.get_cities(pinyin)
    if not years_cities:
        return {}
    code_to_emp = {}
    for year, cities in years_cities.items():
        for city in cities:
            page, total_pages = 1, 1
            while page <= total_pages:
                total_pages, df = xduim.fetch_page(pinyin, city, year, page)
                page += 1
                if df.empty:
                    continue
                df = xduim._normalize_columns(df)
                if "code" not in df.columns or "employer" not in df.columns:
                    continue
                for _, r in df.iterrows():
                    code = str(r.get("code") or "").strip()
                    emp = str(r.get("employer") or "").strip()
                    if code and emp and emp.lower() != "nan":
                        code_to_emp[code] = emp
                time.sleep(0.2)
    return code_to_emp


def backfill_xduim() -> dict:
    """xduim 省考职位表：按 source_url 找出有空单位的省份，重抓页面按职位代码回填。"""
    db = SessionLocal()
    stats = {"provinces": {}, "filled": 0, "checked": 0}
    try:
        rows = (
            db.query(Position.source_url, func.count(Position.id))
            .filter(_VALID, _BLANK, Position.source_url.like("%xduim.com/zw/%"))
            .group_by(Position.source_url)
            .all()
        )
        prov_urls = [u for u, _ in rows if re.fullmatch(r"https://www\.xduim\.com/zw/[a-z]+", u or "")]
        offline_map = _load_unit_map()
        for src in prov_urls:
            pinyin = src.rsplit("/", 1)[-1]
            code_to_emp = offline_map.get(pinyin) or {}
            source = "离线映射"
            if not code_to_emp:
                source = "在线抓取"
                code_to_emp = _fetch_online_map(pinyin)
            if not code_to_emp:
                print(f"[skip] {pinyin}: 无离线映射且在线未取到 代码→单位 映射")
                continue
            filled = 0
            targets = (
                db.query(Position.id, Position.position_example)
                .filter(_VALID, _BLANK, Position.source_url == src)
                .all()
            )
            for pid, pos_example in targets:
                stats["checked"] += 1
                code = (pos_example or "").split(" ", 1)[0].strip()
                emp = code_to_emp.get(code)
                if emp:
                    db.query(Position).filter(Position.id == pid).update({"employer": emp})
                    filled += 1
                    if filled % BATCH == 0:
                        db.commit()
            db.commit()
            stats["provinces"][pinyin] = {"map_size": len(code_to_emp), "filled": filled, "source": source}
            stats["filled"] += filled
            print(f"[xduim] {pinyin}: {source} 映射 {len(code_to_emp)} 条，回填 {filled} 条")
    finally:
        db.close()
    return stats


def _parse_detail(html: str) -> str:
    def cell(label: str) -> str:
        m = re.search(rf"<td>{label}</td>\s*<td>([^<]*)</td>", html)
        return m.group(1).strip() if m else ""

    emp = cell("招考单位") or cell("主管部门")
    return _ORG_CODE_RE.sub("", emp).strip()


def backfill_zgsydw(limit: int | None = None, sleep: float = 0.15) -> dict:
    """zgsydw 空单位行：逐条抓详情页取 招考单位/主管部门（源无值则保持空）。"""
    db = SessionLocal()
    stats = {"checked": 0, "filled": 0, "source_empty": 0, "fetch_fail": 0}
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0"
    try:
        q = (
            db.query(Position.id, Position.source_url)
            .filter(_VALID, _BLANK, Position.source_url.like("%zgsydw.com/web/retrieval/info/%"))
            .order_by(Position.id)
        )
        if limit:
            q = q.limit(limit)
        targets = q.all()
        for pid, source_url in targets:
            stats["checked"] += 1
            try:
                r = session.get(source_url, timeout=20)
                r.raise_for_status()
            except Exception:
                stats["fetch_fail"] += 1
                continue
            emp = _parse_detail(r.text)
            if emp:
                db.query(Position).filter(Position.id == pid).update({"employer": emp})
                stats["filled"] += 1
                if stats["filled"] % 200 == 0:
                    db.commit()
                    print(f"[zgsydw] 进度：checked={stats['checked']} filled={stats['filled']}")
            else:
                stats["source_empty"] += 1
            time.sleep(sleep)
        db.commit()
    finally:
        db.close()
    print(f"[zgsydw] 完成：{stats}")
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", nargs="?", default="all", choices=["all", "xduim", "zgsydw"])
    ap.add_argument("--limit", type=int, default=None, help="zgsydw 本次最多处理条数（分批用）")
    ap.add_argument("--sleep", type=float, default=0.15, help="zgsydw 每条详情页间隔秒数")
    args = ap.parse_args()
    if args.target in ("all", "xduim"):
        print("== xduim 省考回填 ==")
        print(backfill_xduim())
    if args.target in ("all", "zgsydw"):
        print("== zgsydw 详情页回填 ==")
        print(backfill_zgsydw(limit=args.limit, sleep=args.sleep))


if __name__ == "__main__":
    main()
