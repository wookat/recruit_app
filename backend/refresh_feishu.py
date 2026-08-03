"""从飞书公开分享多维表格增量刷新 campus_jobs / bianzhi_jobs。

无需登录 token：直接请求 base 分享页拿匿名会话 cookie，再走网页端
/space/api/v1/bitable/{token}/clientvars 与 /records 接口分页拉取
（响应体为 base64+gzip 的 JSON）。字段按名称映射到现有导入脚本
（import_campus / import_bianzhi）的清洗与 content_hash 逻辑，
按 content_hash upsert：新增插入、已存在跳过，绝不删除现有数据。
超链接字段取 URL（segment.link）而非显示文字。

用法：
    python refresh_feishu.py --dry-run   # 只打印各表将新增条数，不写库
    python refresh_feishu.py             # 实际写库并记录 crawl_runs
"""
import argparse
import base64
import gzip
import json
import re
import sys
import time
from datetime import datetime, timezone

import requests
from sqlalchemy import text

from database import Base, SessionLocal, engine
from models import BianzhiJob, CampusJob, CrawlRun, WatchSource
import import_bianzhi
from data_clean import clean_major_requirement, clean_positions, is_bianzhi_junk_row
import import_campus

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
PAGE_SIZE = 2000
REQUEST_TIMEOUT = 60

SOURCES = [
    {
        "name": "feishu_campus",
        "base_url": "https://acnr1ayjzqxf.feishu.cn",
        "share_token": "ISNobVuXAagJBFssvszcYeqQnfb",
        "kind": "campus",
    },
    {
        "name": "feishu_bianzhi",
        "base_url": "https://acnahk1qvcna.feishu.cn",
        "share_token": "HVc8bY4ryaBtHKsxFRjc5tYynMf",
        "kind": "bianzhi",
    },
]

# 超链接字段：取 URL 而非显示文字
URL_FIELDS = {"announce_url", "apply_url"}

# 说明文案行（非岗位）：单位名含引导提示词
NOTE_PHRASE_RE = re.compile(r"请到|特此提示|【提示】|更多.*查看")


def is_bianzhi_note_row(d: dict) -> bool:
    """保守判定说明文案行：单位名含提示词 且 无截止/考试日期 且 公告链接缺失或无效。"""
    employer = (d.get("employer") or "").strip()
    if not employer or not NOTE_PHRASE_RE.search(employer):
        return False
    if (d.get("deadline_text") or "").strip() or (d.get("exam_time") or "").strip():
        return False
    announce = (d.get("announce_url") or "").strip()
    return announce in ("", "http://", "https://")


def _unpack(blob: str):
    """飞书接口的 base64+gzip JSON 负载。"""
    return json.loads(gzip.decompress(base64.b64decode(blob)))


class FeishuShareClient:
    """匿名读取飞书公开分享多维表格。"""

    def __init__(self, base_url: str, share_token: str):
        self.base_url = base_url.rstrip("/")
        self.token = share_token
        self.session = requests.Session()
        self.session.headers["User-Agent"] = UA

    def open(self):
        r = self.session.get(f"{self.base_url}/base/{self.token}", timeout=REQUEST_TIMEOUT)
        r.raise_for_status()

    def load_tables(self, table_ids: list) -> dict:
        """POST tablesv3 加载数据表快照（records 接口分页前必需），返回 {tid: table_payload}。"""
        r = self.session.post(
            f"{self.base_url}/space/api/bitable/{self.token}/tablesv3/",
            json={
                "tableIDList": table_ids,
                "tablePartitionFlagList": [0],
                "tablePartitionForNoRankFlagList": [],
                "encodingProtocol": {"compression": 1, "serialization": 0},
            },
            headers={
                "X-Csrftoken": self.session.cookies.get("swp_csrf_token", ""),
                "Referer": f"{self.base_url}/base/{self.token}",
            },
            timeout=REQUEST_TIMEOUT,
        )
        r.raise_for_status()
        payload = r.json()
        if payload.get("code") != 0:
            raise RuntimeError(f"tablesv3 code={payload.get('code')} msg={payload.get('msg')}")
        return {tid: _unpack(blob) for tid, blob in (payload.get("data") or {}).items()}

    def _clientvars(self, table_id: str = "") -> dict:
        # 用独立会话：同一会话调过 clientvars 后 tablesv3 会报 csrf token error
        temp = requests.Session()
        temp.headers["User-Agent"] = UA
        temp.get(f"{self.base_url}/base/{self.token}", timeout=REQUEST_TIMEOUT).raise_for_status()
        r = temp.get(
            f"{self.base_url}/space/api/v1/bitable/{self.token}/clientvars",
            params={
                "tableID": table_id,
                "recordLimit": 1,
                "ondemandLimit": 1,
                "needBase": "true",
                "viewLazyLoad": "true",
                "ondemandVer": 2,
                "openType": 0,
            },
            timeout=REQUEST_TIMEOUT,
        )
        r.raise_for_status()
        payload = r.json()
        if payload.get("code") != 0:
            raise RuntimeError(f"clientvars code={payload.get('code')} msg={payload.get('msg')}")
        return payload["data"]

    def list_tables(self) -> list:
        """返回 base 内数据表 [{'id','name'}]（跳过文档等非数据表 block）。"""
        base_info = _unpack(self._clientvars()["base"])
        infos = base_info.get("blockInfos") or {}
        tables = []
        for blk in base_info.get("blocks") or []:
            info = infos.get(blk) or {}
            if str(blk).startswith("tbl"):
                tables.append({"id": blk, "name": info.get("name") or blk})
        return tables

    @staticmethod
    def table_schema(table: dict) -> dict:
        """从 tablesv3 表负载提取 {'field_names': {fid: name}, 'options': {fid: {opt_id: opt_name}},
        'date_fields': set, 'view_id': str, 'table_rev': int, 'records_num': int}."""
        field_names, options, date_fields = {}, {}, set()
        for fid, f in (table.get("fieldMap") or {}).items():
            field_names[fid] = f.get("name") or fid
            if f.get("fieldUIType") == "DateTime":
                date_fields.add(fid)
            prop = f.get("property") or {}
            if isinstance(prop, dict) and prop.get("options"):
                options[fid] = {o.get("id"): o.get("name", "") for o in prop["options"]}
        views = table.get("views") or []
        return {
            "field_names": field_names,
            "options": options,
            "date_fields": date_fields,
            "view_id": views[0] if views else "",
            "table_rev": (table.get("meta") or {}).get("rev") or 0,
            "records_num": (table.get("meta") or {}).get("recordsNum") or 0,
        }

    def iter_record_cells(self, table_id: str, schema: dict):
        """分页拉取全部记录，逐条 yield {field_id: cell}。"""
        offset = 0
        seen = set()
        while True:
            r = self.session.get(
                f"{self.base_url}/space/api/v1/bitable/{self.token}/records",
                params={
                    "tableId": table_id,
                    "viewId": schema["view_id"],
                    "tableRev": schema["table_rev"],
                    "depRev": "{}",
                    "viewLazyLoad": "true",
                    "offset": offset,
                    "limit": PAGE_SIZE,
                    "tableID": table_id,
                    "viewID": schema["view_id"],
                    "removeFmlExtra": "true",
                },
                timeout=REQUEST_TIMEOUT,
            )
            r.raise_for_status()
            payload = r.json()
            if payload.get("code") != 0:
                raise RuntimeError(f"records code={payload.get('code')} msg={payload.get('msg')}")
            unpacked = _unpack(payload["data"]["records"])
            if unpacked.get("tableID") != table_id:
                raise RuntimeError(f"records 返回表不匹配: 请求 {table_id} 返回 {unpacked.get('tableID')}")
            record_map = unpacked.get("recordMap") or {}
            new_ids = [rid for rid in record_map if rid not in seen]
            if not new_ids:
                break
            for rid in new_ids:
                seen.add(rid)
                yield record_map[rid]
            offset += PAGE_SIZE
            time.sleep(0.2)


def _cell_text(cell, opt_map: dict, is_date: bool) -> str:
    """单元格值转纯文本（选项映射为名称、时间戳格式化、段落拼接）。"""
    if not cell:
        return ""
    value = cell.get("value")
    if value is None:
        return ""
    if isinstance(value, (int, float)) and is_date:
        try:
            return time.strftime("%Y/%m/%d", time.gmtime(value / 1000 + 8 * 3600))
        except (OverflowError, OSError, ValueError):
            return ""
    if isinstance(value, str):
        return opt_map.get(value, value).strip() if opt_map else value.strip()
    if isinstance(value, list):
        parts = []
        for seg in value:
            if isinstance(seg, dict):
                parts.append(seg.get("text", ""))
            elif isinstance(seg, str):
                parts.append(opt_map.get(seg, seg) if opt_map else seg)
        return ", ".join(p.strip() for p in parts if p and p.strip())
    return str(value).strip()


def _cell_url(cell) -> str:
    """超链接字段：优先取 url segment 的 link，其次纯文本。"""
    if not cell:
        return ""
    value = cell.get("value")
    if isinstance(value, list):
        for seg in value:
            if isinstance(seg, dict) and seg.get("link"):
                return seg["link"].strip()
        return ", ".join(
            seg.get("text", "").strip() for seg in value if isinstance(seg, dict) and seg.get("text")
        )
    if isinstance(value, str):
        return value.strip()
    return ""


def _norm_name(name: str) -> str:
    """表名归一化用于匹配（去掉括号后缀、符号与 emoji）。"""
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]", "", re.sub(r"[（(].*$", "", name or ""))


def _match_spec(table_name: str, specs: dict):
    normed = _norm_name(table_name)
    for key, colmap in specs.items():
        if normed.startswith(_norm_name(key)) or table_name.startswith(key):
            return key, colmap
    return None


def _extract_rows(client: FeishuShareClient, table_id: str, table_payload: dict, colmap: dict) -> list:
    """按 列名->模型字段 映射拉取一张表的全部行（dict 已 norm）。"""
    schema = client.table_schema(table_payload)
    name_to_fid = {name: fid for fid, name in schema["field_names"].items()}
    rows = []
    for cells in client.iter_record_cells(table_id, schema):
        d = {}
        for field, col in colmap.items():
            fid = name_to_fid.get(col)
            if not fid:
                d[field] = ""
                continue
            cell = cells.get(fid)
            if field in URL_FIELDS:
                d[field] = _cell_url(cell)
            else:
                d[field] = _cell_text(cell, schema["options"].get(fid, {}), fid in schema["date_fields"])
        rows.append(d)
    return rows


CAMPUS_LIMITS = {"company": 300, "company_type": 50, "industry": 200, "batch": 100,
                 "grad_years": 100, "no_exam": 50, "edu_requirement": 200,
                 "locations": 500, "start_date": 30, "deadline_text": 200,
                 "referral_code": 200, "updated_at_src": 30, "source_table": 50}


def _refresh_campus(client: FeishuShareClient, db, dry_run: bool) -> dict:
    existing = {h for (h,) in db.execute(text("SELECT content_hash FROM campus_jobs"))}
    existing_cross = import_campus.existing_cross_hashes(db)
    counts = {"fetched": 0, "added": 0, "skipped": 0, "failed": 0, "tables": {}}
    matched = [(tbl, spec) for tbl in client.list_tables()
               if (spec := _match_spec(tbl["name"], import_campus.TABLE_SPECS))]
    payloads = client.load_tables([tbl["id"] for tbl, _ in matched])
    for tbl, (source_table, colmap) in matched:
        added = skipped = 0
        rows = _extract_rows(client, tbl["id"], payloads[tbl["id"]], colmap)
        counts["fetched"] += len(rows)
        for d in rows:
            if not d.get("company"):
                skipped += 1
                continue
            if "major_requirement" in d:
                d["major_requirement"] = clean_major_requirement(d["major_requirement"])
            if "positions" in d:
                d["positions"] = clean_positions(d["positions"])
            h = import_campus.row_hash(source_table, d)
            xh = import_campus.cross_hash_of(d)
            if h in existing or xh in existing_cross:
                skipped += 1
                continue
            existing.add(h)
            existing_cross.add(xh)
            added += 1
            if dry_run:
                continue
            for k, lim in CAMPUS_LIMITS.items():
                if k in d and d[k]:
                    d[k] = d[k][:lim]
            db.add(CampusJob(source_table=source_table, content_hash=h, **d))
        if not dry_run:
            db.commit()
        counts["added"] += added
        counts["skipped"] += skipped
        counts["tables"][tbl["name"]] = {"fetched": len(rows), "added": added, "skipped": skipped}
    return counts


def _refresh_bianzhi(client: FeishuShareClient, db, dry_run: bool) -> dict:
    existing = {h for (h,) in db.execute(text("SELECT content_hash FROM bianzhi_jobs"))}
    counts = {"fetched": 0, "added": 0, "skipped": 0, "failed": 0, "tables": {}}
    tables = client.list_tables()
    matched = [(tbl, spec) for tbl in tables
               if (spec := _match_spec(tbl["name"], import_bianzhi.TABLE_SPECS))]
    if not matched:
        raise RuntimeError("base 内未发现可映射到 bianzhi_jobs 的数据表（表名/列名与预期不符）")
    # 该 base 内的「央国企校招」表属于 campus_jobs 口径（import_campus 同名 spec）
    matched_ids = {tbl["id"] for tbl, _ in matched}
    campus_extra = [(tbl, spec) for tbl in tables if tbl["id"] not in matched_ids
                    and (spec := _match_spec(tbl["name"], {"央国企校招": import_campus.TABLE_SPECS["央国企校招"]}))]
    payloads = client.load_tables([tbl["id"] for tbl, _ in matched + campus_extra])
    for tbl, (spec_key, colmap) in matched:
        category = import_bianzhi.CATEGORY_NAMES.get(spec_key, spec_key)
        added = skipped = 0
        rows = _extract_rows(client, tbl["id"], payloads[tbl["id"]], colmap)
        counts["fetched"] += len(rows)
        for d in rows:
            if not d.get("employer") and not d.get("province"):
                skipped += 1
                continue
            if is_bianzhi_note_row(d) or is_bianzhi_junk_row(d):
                skipped += 1
                continue
            h = import_bianzhi.row_hash(category, d)
            if h in existing:
                skipped += 1
                continue
            existing.add(h)
            added += 1
            if dry_run:
                continue
            for k, lim in import_bianzhi.LIMITS.items():
                if k in d and d[k]:
                    d[k] = d[k][:lim]
            db.add(BianzhiJob(category=category, content_hash=h, **d))
        if not dry_run:
            db.commit()
        counts["added"] += added
        counts["skipped"] += skipped
        counts["tables"][tbl["name"]] = {"fetched": len(rows), "added": added, "skipped": skipped}
    if campus_extra:
        campus_existing = {h for (h,) in db.execute(text("SELECT content_hash FROM campus_jobs"))}
        campus_existing_cross = import_campus.existing_cross_hashes(db)
        for tbl, (source_table, colmap) in campus_extra:
            added = skipped = 0
            rows = _extract_rows(client, tbl["id"], payloads[tbl["id"]], colmap)
            counts["fetched"] += len(rows)
            for d in rows:
                if not d.get("company"):
                    skipped += 1
                    continue
                if "major_requirement" in d:
                    d["major_requirement"] = clean_major_requirement(d["major_requirement"])
                if "positions" in d:
                    d["positions"] = clean_positions(d["positions"])
                h = import_campus.row_hash(source_table, d)
                xh = import_campus.cross_hash_of(d)
                if h in campus_existing or xh in campus_existing_cross:
                    skipped += 1
                    continue
                campus_existing.add(h)
                campus_existing_cross.add(xh)
                added += 1
                if dry_run:
                    continue
                for k, lim in CAMPUS_LIMITS.items():
                    if k in d and d[k]:
                        d[k] = d[k][:lim]
                db.add(CampusJob(source_table=source_table, content_hash=h, **d))
            if not dry_run:
                db.commit()
            counts["added"] += added
            counts["skipped"] += skipped
            counts["tables"][tbl["name"]] = {"fetched": len(rows), "added": added,
                                             "skipped": skipped, "target": "campus_jobs"}
    return counts


REFRESHERS = {"campus": _refresh_campus, "bianzhi": _refresh_bianzhi}


def _get_or_create_source(db, name: str, index_url: str) -> WatchSource:
    src = db.query(WatchSource).filter(WatchSource.name == name).first()
    if not src:
        # enabled=0：仅作为 crawl_runs 归属，不参与公告采集调度
        src = WatchSource(name=name, index_url=index_url, category="飞书表格", enabled=0, interval_minutes=1440)
        db.add(src)
        db.commit()
    return src


def _record_run(db, source: WatchSource, status: str, counts: dict, error: str = None):
    db.add(CrawlRun(
        source_id=source.id,
        status=status,
        finished_at=datetime.now(timezone.utc),
        announcements_found=counts.get("skipped", 0),
        rows_parsed=counts.get("fetched", 0),
        rows_ingested=counts.get("added", 0),
        error=(error or "")[:4000] or None,
    ))
    source.last_checked_at = datetime.now(timezone.utc)
    source.last_status = "ok" if status == "success" else "error"
    source.last_message = (error or json.dumps(counts.get("tables", {}), ensure_ascii=False))[:500]
    db.commit()


def refresh_all(dry_run: bool = False) -> dict:
    """刷新全部飞书来源。单个来源失败记 failed 继续，不抛未捕获异常。"""
    Base.metadata.create_all(bind=engine, tables=[CampusJob.__table__, BianzhiJob.__table__,
                                                  CrawlRun.__table__, WatchSource.__table__])
    results = {}
    db = SessionLocal()
    try:
        for src_cfg in SOURCES:
            name = src_cfg["name"]
            counts = {"fetched": 0, "added": 0, "skipped": 0, "failed": 0}
            try:
                client = FeishuShareClient(src_cfg["base_url"], src_cfg["share_token"])
                client.open()
                counts = REFRESHERS[src_cfg["kind"]](client, db, dry_run)
                status, error = "success", None
            except Exception as exc:  # noqa: BLE001  网络/接口变动安全退出
                db.rollback()
                counts["failed"] = 1
                status, error = "error", f"{type(exc).__name__}: {exc}"
            if not dry_run:
                source = _get_or_create_source(
                    db, name, f"{src_cfg['base_url']}/base/{src_cfg['share_token']}")
                _record_run(db, source, status, counts, error)
            results[name] = {
                "status": "failed" if status == "error" else status,
                **counts,
                **({"error": error} if error else {}),
            }
    finally:
        db.close()
    return results


def main():
    parser = argparse.ArgumentParser(description="飞书多维表格增量刷新 campus_jobs / bianzhi_jobs")
    parser.add_argument("--dry-run", action="store_true", help="只打印各表将新增条数，不写库")
    args = parser.parse_args()
    results = refresh_all(dry_run=args.dry_run)
    print(json.dumps(results, ensure_ascii=False, indent=2))
    if all(r["status"] == "failed" for r in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
