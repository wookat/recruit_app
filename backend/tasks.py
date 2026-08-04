import csv
import json
import os
import re
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests
import pandas as pd
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session
from celery_app import celery_app
from database import SessionLocal
from ingest import ingest_positions_df
from models import CrawlRun
import check_links
import collector
import crud
import pipeline
import precompute
import backfill_deadlines
import bianzhi as bianzhi_api
import campus as campus_api
import csv_export
import quality
from models import BianzhiJob, CampusJob, PushSubscription
from pywebpush import webpush, WebPushException
import refresh_feishu
import import_guopin_2027
from cache import get_redis
from etl.normalize_v2 import parse_signup_deadline_v2
from recruit_parser import (
    crawl_xds_summary,
    extract_official_and_files,
    download_file,
    extract_zip,
    parse_position_excel,
)

APP_DATA_DIR = os.getenv("APP_DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"))
os.makedirs(APP_DATA_DIR, exist_ok=True)

EXPORTS_DIR = os.getenv("EXPORTS_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "exports"))
os.makedirs(EXPORTS_DIR, exist_ok=True)
EXPORT_FILE_MAX_AGE = 24 * 3600


def _download(url: str, path: str):
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=120)
    r.raise_for_status()
    with open(path, "wb") as f:
        f.write(r.content)
    return path


@celery_app.task(bind=True)
def scrape_year(self, year: int):
    self.update_state(state="PROGRESS", meta={"step": "dispatching subtasks"})
    if year == 2025:
        scrape_guokao_2025.delay()
        scrape_xds.delay(2025)
        scrape_shengkao_sources.delay(2025)
        scrape_jdwz_2025.delay()
    elif year == 2026:
        scrape_xds.delay(2026)
    elif year == 2027:
        scrape_guopin_2027.delay()
    return {"year": year, "status": "dispatched"}


@celery_app.task(bind=True)
def scrape_guopin_2027(self):
    self.update_state(state="PROGRESS", meta={"step": "fetching guopin campus jobs"})
    try:
        import_guopin_2027.run()
        return {"status": "done", "source": "https://www.iguopin.com"}
    except Exception as exc:
        raise self.retry(exc=exc, countdown=60)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def scrape_guokao_2025(self):
    try:
        url = "https://u3.huatu.com/uploads/soft/241014/f1.xls"
        path = os.path.join(APP_DATA_DIR, "guokao_2025.xls")
        _download(url, path)
        df = parse_position_excel(
            path,
            province="全国",
            source_url="http://bm.scs.gov.cn/kl2025",
            default_exam="2025国家公务员考试",
            job_type="公务员",
        )
        df["year"] = 2025
        df["报名时间"] = "2024-10-15 8:00 至 2024-10-24 18:00"
        df["笔试/考试时间"] = "2024-11-30"
        db = SessionLocal()
        try:
            ingest_positions_df(db, df)
            db.commit()
        finally:
            db.close()
        return {"rows": len(df), "source": url}
    except Exception as exc:
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def scrape_jdwz_2025(self):
    source = "http://81rc.81.cn/wzry/gzdt/"
    files = [
        ("https://u3.huatu.com/uploads/soft/241107/660647-24110H00J82439773927.xlsx",
         "2025军队文职公开招考（不含先面试后笔试）"),
        ("https://u3.huatu.com/uploads/soft/241107/660647-24110H00K85822132235.xlsx",
         "2025军队文职公开招考（先面试后笔试）"),
    ]
    total = 0
    for url, exam in files:
        try:
            fn = url.split("/")[-1]
            path = os.path.join(APP_DATA_DIR, f"jdwz2025_{fn}")
            _download(url, path)
            df = parse_position_excel(
                path,
                province="全国",
                source_url=source,
                default_exam=exam,
                job_type="军队文职",
            )
            df["year"] = 2025
            df["报名时间"] = "2024-11-08 8:00 至 2024-11-14 18:00"
            df["笔试/考试时间"] = "2024-12-28"
            db = SessionLocal()
            try:
                ingest_positions_df(db, df)
                db.commit()
            finally:
                db.close()
            total += len(df)
        except Exception as exc:
            raise self.retry(exc=exc)
    return {"rows": total, "source": source}


@celery_app.task(bind=True)
def scrape_xds(self, year: int):
    if year == 2026:
        url = "https://www.jingjia.org/xds/526923.html"
    elif year == 2025:
        url = "https://www.jingjia.org/xds/503383.html"
    else:
        return {"status": "no_summary_url"}

    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.encoding = "utf-8"
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(r.text, "html.parser")
    rows = []
    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) >= 4:
                cells = [td.get_text(strip=True) for td in tds]
                if cells[0] == "省份":
                    continue
                links = [a.get("href") for a in tr.find_all("a") if a.get("href")]
                rows.append({
                    "省份": cells[0],
                    "招录人数": cells[2] if len(cells) > 2 else "",
                    "报名时间": cells[3] if len(cells) > 3 else "",
                    "笔试时间": cells[4] if len(cells) > 4 else "",
                    "笔试内容": cells[5] if len(cells) > 5 else "",
                    "detail_url": links[0] if links else "",
                })

    for row in rows:
        if row["detail_url"]:
            parse_xds_detail.delay(year, row)
    return {"year": year, "provinces": len(rows)}


@celery_app.task(bind=True)
def parse_xds_detail(self, year: int, row: dict):
    province = row["省份"]
    detail_url = row.get("detail_url", "")
    if not detail_url:
        return {"province": province, "status": "no_detail_url"}

    out_dir = os.path.join(APP_DATA_DIR, f"xds_{year}")
    os.makedirs(out_dir, exist_ok=True)

    try:
        official_url, file_urls = extract_official_and_files(detail_url)
    except Exception as e:
        return {"province": province, "error": str(e)}

    if not file_urls:
        return {"province": province, "status": "no_files"}

    downloaded = []
    for fu in file_urls:
        try:
            downloaded.append(download_file(fu, out_dir))
        except Exception:
            continue

    db = SessionLocal()
    try:
        for fp in downloaded:
            if fp.endswith(".zip"):
                extracted = extract_zip(fp, out_dir, prefix=f"{year}_{province}_zip")
                for ef in extracted:
                    if ef.endswith((".xlsx", ".xls")):
                        _parse_xds_file(db, year, province, ef, detail_url)
            elif fp.endswith((".xlsx", ".xls")):
                _parse_xds_file(db, year, province, fp, detail_url)
        db.commit()
    finally:
        db.close()

    return {"province": province, "status": "done", "files": len(downloaded)}


def _parse_xds_file(db: Session, year: int, province: str, fp: str, source_url: str):
    base = os.path.basename(fp)
    if any(k in base for k in ["专业目录", "参考目录", "填报指南", "报名推荐表", "高校名单", "学科名单", "政策问答"]):
        return
    if "优培" in base or "事业单位" in base or "引进" in base:
        job_type = "事业编/事业单位"
        default_exam = f"{year}{province}优培计划/事业单位招聘"
    else:
        job_type = "选调生"
        default_exam = f"{year}{province}定向选调生"
    try:
        df = parse_position_excel(
            fp,
            province=province,
            source_url=source_url,
            default_exam=default_exam,
            job_type=job_type,
        )
    except Exception:
        return
    if df.empty:
        return
    df["year"] = year
    ingest_positions_df(db, df)


@celery_app.task(bind=True)
def scrape_shengkao_sources(self, year: int):
    # 省考岗位分散在各省人事考试网，先建立入口目录；具体职位表可后续按省份抓取
    return {"status": "placeholder", "year": year, "note": "省考职位表按省份分散，建议后续逐省队列抓取"}


def _write_export_csv(rows, path):
    """逐行写 CSV（服务器游标 yield_per 分批取数，不构建 DataFrame）。"""
    cols = crud.EXPORT_COLUMNS
    n = 0
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([label for _, label in cols])
        for pos in rows:
            writer.writerow([getattr(pos, attr, "") or "" for attr, _ in cols])
            n += 1
    return n


def _write_export_xlsx(rows, path):
    """openpyxl write_only 流式写 xlsx，避免一次性 DataFrame。"""
    from openpyxl import Workbook

    cols = crud.EXPORT_COLUMNS
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("岗位")
    ws.append([label for _, label in cols])
    n = 0
    for pos in rows:
        ws.append([str(getattr(pos, attr, "") or "") for attr, _ in cols])
        n += 1
    wb.save(path)
    return n


@celery_app.task(bind=True)
def export_positions_task(self, filters: dict, format: str = "csv", sort: str = "year_desc", max_rows: int = 50000, fname: "str | None" = None):
    """异步导出：分批读库逐行写文件到 exports/，返回文件名与行数。"""
    self.update_state(state="PROGRESS", meta={"step": "exporting"})
    fmt = "xlsx" if format == "xlsx" else "csv"
    base = csv_export.safe_fname(fname, f"positions_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    fname = f"{base}_{self.request.id[:8]}.{fmt}"
    path = os.path.join(EXPORTS_DIR, fname)
    db = SessionLocal()
    try:
        f = crud.PositionFilter(**(filters or {}))
        rows = crud.export_positions(db, f, sort=sort, max_rows=min(int(max_rows), 50000))
        n = _write_export_xlsx(rows, path) if fmt == "xlsx" else _write_export_csv(rows, path)
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        raise
    finally:
        db.close()
    return {"file": fname, "rows": n, "format": fmt}


@celery_app.task(bind=True)
def export_board_task(self, board: str, filters: dict, fname: "str | None" = None, max_rows: int = 50000):
    """校招/编制列表异步导出 CSV：写文件到 exports/，返回文件名与行数。"""
    self.update_state(state="PROGRESS", meta={"step": "exporting"})
    if board == "campus":
        cols = campus_api.CAMPUS_EXPORT_COLUMNS
    elif board == "bianzhi":
        cols = bianzhi_api.BIANZHI_EXPORT_COLUMNS
    else:
        raise ValueError(f"不支持的导出板块: {board}")
    default = f"{board}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    base = csv_export.safe_fname(fname, default)
    out_name = f"{base}_{self.request.id[:8]}.csv"
    path = os.path.join(EXPORTS_DIR, out_name)
    db = SessionLocal()
    try:
        f = filters or {}
        due = f.get("due_within_days")
        if board == "campus":
            q = campus_api.apply_campus_filters(db.query(CampusJob), f)
            order = campus_api.campus_export_order(due)
        else:
            q = bianzhi_api.apply_bianzhi_filters(db.query(BianzhiJob), f)
            order = bianzhi_api.bianzhi_export_order(due)
        rows = q.order_by(*order).limit(max(1, min(int(max_rows), 50000))).yield_per(500)
        n = csv_export.write_csv(rows, cols, path)
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        raise
    finally:
        db.close()
    return {"file": out_name, "rows": n, "format": "csv"}


@celery_app.task
def cleanup_exports():
    """每日清理 exports/ 中超过 24h 的导出文件。"""
    now = time.time()
    removed = 0
    for name in os.listdir(EXPORTS_DIR):
        p = os.path.join(EXPORTS_DIR, name)
        try:
            if os.path.isfile(p) and now - os.path.getmtime(p) > EXPORT_FILE_MAX_AGE:
                os.remove(p)
                removed += 1
        except OSError:
            continue
    return {"removed": removed}


@celery_app.task
def push_due_reminders():
    """每日向 Web Push 订阅者推送临近截止的收藏提醒（每订阅至多一条聚合通知）。"""
    private_key = os.getenv("VAPID_PRIVATE_KEY", "")
    sub_claim = os.getenv("VAPID_SUB", "mailto:admin@zalize.com")
    if not private_key:
        return {"status": "skipped", "reason": "VAPID_PRIVATE_KEY not set"}

    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    db = SessionLocal()
    sent = removed = failed = 0
    try:
        subs = db.query(PushSubscription).all()
        for sub in subs:
            try:
                items = json.loads(sub.items_json or "[]")
            except ValueError:
                items = []
            due = []
            for it in items:
                try:
                    d = datetime.strptime(it.get("d", ""), "%Y-%m-%d").date()
                except ValueError:
                    continue
                n = (d - today).days
                if 0 <= n <= (sub.remind_days or 3):
                    due.append((n, it.get("t", "")))
            if not due:
                continue
            due.sort()
            first = due[0]
            body = f"最近的一条：{first[1]}（{'今天截止' if first[0] == 0 else f'剩 {first[0]} 天'}）"
            payload = json.dumps(
                {
                    "title": f"上岸雷达：{len(due)} 条收藏即将截止报名",
                    "body": body,
                    "url": "/?fav=1",
                },
                ensure_ascii=False,
            )
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                    },
                    data=payload,
                    vapid_private_key=private_key,
                    vapid_claims={"sub": sub_claim},
                    ttl=3600 * 12,
                )
                sent += 1
            except Exception as exc:  # noqa: BLE001  单个坏订阅不阻断其余推送
                status = (
                    exc.response.status_code
                    if isinstance(exc, WebPushException) and exc.response is not None
                    else None
                )
                if status in (404, 410):
                    db.delete(sub)
                    removed += 1
                else:
                    sub.failures = (sub.failures or 0) + 1
                    if sub.failures >= 5:
                        db.delete(sub)
                        removed += 1
                    failed += 1
        db.commit()
    finally:
        db.close()
    return {"status": "ok", "sent": sent, "removed": removed, "failed": failed}


INTERNAL_API_BASE = os.getenv("INTERNAL_API_BASE", "http://app:8000")


@celery_app.task
def push_saved_filter_news():
    """每日向 Web Push 订阅者推送保存筛选的上新聚合（关站也能收到「+N 新」）。

    基线存在订阅的 filters_json 中：首次见到某筛选只记录当前总数不推送，
    此后总数增长即计入上新；推送与否都回写最新基线。
    """
    private_key = os.getenv("VAPID_PRIVATE_KEY", "")
    sub_claim = os.getenv("VAPID_SUB", "mailto:admin@zalize.com")
    if not private_key:
        return {"status": "skipped", "reason": "VAPID_PRIVATE_KEY not set"}

    db = SessionLocal()
    sent = removed = failed = 0
    totals_cache: dict = {}
    try:
        subs = db.query(PushSubscription).all()
        for sub in subs:
            try:
                filters = json.loads(sub.filters_json or "[]")
            except ValueError:
                filters = []
            if not filters:
                continue
            news = []
            dirty = False
            for f in filters:
                u = f.get("u") or ""
                if u not in totals_cache:
                    try:
                        resp = requests.get(f"{INTERNAL_API_BASE}{u}", timeout=20)
                        resp.raise_for_status()
                        totals_cache[u] = int(resp.json().get("total", 0))
                    except Exception:  # noqa: BLE001  单个筛选失败不阻断其余
                        totals_cache[u] = None
                total = totals_cache[u]
                if total is None:
                    continue
                base = f.get("t")
                if isinstance(base, int) and total > base:
                    news.append((total - base, f.get("n") or ""))
                if f.get("t") != total:
                    f["t"] = total
                    dirty = True
            if dirty:
                sub.filters_json = json.dumps(filters, ensure_ascii=False)
            if not news:
                continue
            news.sort(reverse=True)
            total_new = sum(n for n, _ in news)
            top = "、".join(f"「{name}」+{n}" for n, name in news[:2])
            payload = json.dumps(
                {
                    "title": f"上岸雷达：你订阅的筛选新增 {total_new} 条岗位",
                    "body": top + ("…" if len(news) > 2 else ""),
                    "url": "/?subs=1",
                },
                ensure_ascii=False,
            )
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                    },
                    data=payload,
                    vapid_private_key=private_key,
                    vapid_claims={"sub": sub_claim},
                    ttl=3600 * 12,
                )
                sent += 1
            except Exception as exc:  # noqa: BLE001  单个坏订阅不阻断其余推送
                status = (
                    exc.response.status_code
                    if isinstance(exc, WebPushException) and exc.response is not None
                    else None
                )
                if status in (404, 410):
                    db.delete(sub)
                    removed += 1
                else:
                    sub.failures = (sub.failures or 0) + 1
                    if sub.failures >= 5:
                        db.delete(sub)
                        removed += 1
                    failed += 1
        db.commit()
    finally:
        db.close()
    return {"status": "ok", "sent": sent, "removed": removed, "failed": failed}


@celery_app.task
def refresh_hot_cache():
    """预计算 /api/stats 与 /api/filters 的 Redis 热缓存（24h TTL），并预热热门筛选 count。"""
    result = precompute.refresh_hot_caches()
    result["warm"] = precompute.warm_common_queries()
    return result


DQ_REPORT_KEY = "dq:report"
DQ_REPORT_TTL = 48 * 3600
DQ_BACKFILL_MAX = 50000
DQ_BACKFILL_BATCH = 2000

_DQ_BACKFILL_UPDATE = sql_text(
    "UPDATE positions SET signup_deadline = :deadline WHERE id = :id"
)


def _backfill_signup_deadlines(db, max_rows: int = DQ_BACKFILL_MAX) -> dict:
    """对 signup_deadline 为空但报名时间原文可解析的行分批回填（短事务）。"""
    scanned, filled, last_id = 0, 0, 0
    while scanned < max_rows:
        batch = min(DQ_BACKFILL_BATCH, max_rows - scanned)
        rows = db.execute(sql_text(
            "SELECT id, year, signup_time FROM positions "
            "WHERE id > :last AND signup_deadline IS NULL "
            "AND signup_time IS NOT NULL AND signup_time <> '' "
            "ORDER BY id LIMIT :lim"
        ), {"last": last_id, "lim": batch}).mappings().all()
        if not rows:
            break
        params = []
        for r in rows:
            dt = parse_signup_deadline_v2(r["signup_time"], default_year=r["year"])
            if dt is not None:
                params.append({"id": r["id"], "deadline": dt})
        if params:
            db.execute(_DQ_BACKFILL_UPDATE, params)
            db.commit()
            filled += len(params)
        scanned += len(rows)
        last_id = rows[-1]["id"]
    return {"scanned": scanned, "filled": filled}


@celery_app.task
def check_dead_links():
    """每周链接死链全量扫描（校招+编制，结果入 link_checks，质量卡展示失效计数）。"""
    db = SessionLocal()
    try:
        return check_links.run_check(db)
    finally:
        db.close()


@celery_app.task
def check_dead_links_new():
    """每日增量死链扫描：只探测同步新入库、link_checks 尚无记录的链接。"""
    db = SessionLocal()
    try:
        return check_links.run_check(db, only_new=True)
    finally:
        db.close()


@celery_app.task
def data_quality_audit():
    """每日数据质量审计：统计指标写入 Redis dq:report（48h TTL），
    顺带增量回填可解析的 signup_deadline（限 5 万行/次）。"""
    from database import engine

    # 维护型任务：绑定单连接并放宽默认 20s 语句超时（大表扫描/统计需更长时间）
    conn = engine.connect()
    conn.execute(sql_text("SET statement_timeout = 300000"))
    conn.commit()
    db = SessionLocal(bind=conn)
    try:
        backfill = _backfill_signup_deadlines(db)

        def scalar(sql, **kw):
            return db.execute(sql_text(sql), kw).scalar() or 0

        def groups(sql):
            return [{"name": str(k), "count": c} for k, c in db.execute(sql_text(sql)).all()]

        clean_where = "dup_of_id IS NULL AND invalid_reason IS NULL"
        total = scalar("SELECT count(*) FROM positions")
        report = {
            "generated_at": datetime.now().isoformat(),
            "rows": {
                "total": total,
                "clean": scalar(f"SELECT count(*) FROM positions WHERE {clean_where}"),
                "dup": scalar("SELECT count(*) FROM positions WHERE dup_of_id IS NOT NULL"),
                "invalid": scalar("SELECT count(*) FROM positions WHERE invalid_reason IS NOT NULL"),
                "added_last_7d": scalar(
                    "SELECT count(*) FROM positions WHERE created_at > now() - interval '7 days'"
                ),
            },
            "by_year": groups(
                f"SELECT year, count(*) FROM positions WHERE {clean_where} GROUP BY year ORDER BY year DESC"
            ),
            "by_job_type": groups(
                f"SELECT job_type, count(*) FROM positions WHERE {clean_where} "
                "GROUP BY job_type ORDER BY count(*) DESC"
            ),
            "missing_fields": {
                col: scalar(
                    f"SELECT count(*) FROM positions WHERE {clean_where} "
                    f"AND ({col} IS NULL OR {col} = '')"
                )
                for col in ("employer", "province", "edu_requirement", "work_location")
            },
            "signup_deadline": {
                "with_signup_time": scalar(
                    f"SELECT count(*) FROM positions WHERE {clean_where} "
                    "AND signup_time IS NOT NULL AND signup_time <> ''"
                ),
                "parsed": scalar(
                    f"SELECT count(*) FROM positions WHERE {clean_where} "
                    "AND signup_time IS NOT NULL AND signup_time <> '' "
                    "AND signup_deadline IS NOT NULL"
                ),
                "backfill": backfill,
            },
        }
        st = report["signup_deadline"]
        st["parse_rate"] = round(st["parsed"] / st["with_signup_time"], 4) if st["with_signup_time"] else None
        get_redis().setex(DQ_REPORT_KEY, DQ_REPORT_TTL, json.dumps(report, default=str))
        return report["rows"] | {"backfill": backfill}
    finally:
        db.close()
        conn.close()


@celery_app.task
def refresh_feishu_data():
    """每日从飞书公开表格增量刷新 campus_jobs / bianzhi_jobs（结果计入 crawl_runs）。"""
    try:
        results = refresh_feishu.refresh_all()
    except Exception as exc:  # noqa: BLE001  不影响其他 beat 任务
        return {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}
    try:
        results["deadline_backfill"] = backfill_deadlines.backfill_all()
    except Exception as exc:  # noqa: BLE001
        results["deadline_backfill"] = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}
    db = SessionLocal()
    try:
        results["quality_issues_warm"] = quality.warm_quality_issues(db)
    except Exception as exc:  # noqa: BLE001
        results["quality_issues_warm"] = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}
    finally:
        db.close()
    try:
        results["hot_keywords_warm"] = precompute.warm_hot_keywords()
    except Exception as exc:  # noqa: BLE001
        results["hot_keywords_warm"] = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}
    return results


@celery_app.task
def check_watch_sources():
    """定时任务：对所有到期启用的来源执行采集闭环（公告→附件→解析→入库）。"""
    db = SessionLocal()
    try:
        results = pipeline.run_due_pipelines(db)
        failed = [r["source"] for r in results if r.get("status") in ("error", "partial")]
        if failed:
            db.add(CrawlRun(
                source_id=None,
                status="alert",
                finished_at=datetime.now(timezone.utc),
                error=json.dumps(failed, ensure_ascii=False)[:4000],
            ))
            db.commit()
        return {"results": results, "failed_sources": failed}
    finally:
        db.close()
