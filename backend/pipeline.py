"""D1 采集闭环：公告 → 附件下载 → 自动解析 → 增量入库 → 后处理。

流程（每个到期来源一次 CrawlRun）：
1. collector.check_source 抓索引页写入新公告
2. 对该来源 status=new 的公告抓详情页，发现 .xls/.xlsx/.zip 附件
3. 附件按 URL + 内容 SHA256 去重，下载失败重试 3 次（指数退避）
4. recruit_parser.parse_position_excel 解析 → ingest.ingest_positions_df 入库
5. 新增行增量 normalize、刷新 search_text、清理 Redis 缓存
6. 公告成功标记 processed，失败标记 error（不中断其他公告）

内存约束：逐附件解析并及时释放 DataFrame（生产 2G 内存，Celery 并发 1）。
"""
import gc
import hashlib
import os
import re
import time
import urllib.parse
from datetime import datetime, timezone

import requests
from sqlalchemy import func as sa_func, text
from sqlalchemy.orm import Session

import collector
from database import Base, engine
from ingest import ingest_positions_df
from models import Announcement, Attachment, CrawlRun, Position, WatchSource
from recruit_parser import extract_zip, parse_position_excel

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
}
ATTACH_EXTS = (".xls", ".xlsx", ".zip")
DOWNLOAD_RETRIES = 3
MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024

APP_DATA_DIR = os.getenv(
    "APP_DATA_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"),
)
ATTACH_DIR = os.path.join(APP_DATA_DIR, "attachments")

# 明显不是职位表的附件文件名关键词
SKIP_FILE_KEYWORDS = (
    "专业目录", "参考目录", "填报指南", "报名推荐表", "高校名单", "学科名单", "政策问答",
)


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def find_attachment_urls(page_url: str, timeout: int = 30) -> list:
    """抓公告详情页，返回职位表附件（xls/xlsx/zip）绝对 URL 列表。"""
    resp = requests.get(page_url, headers=HEADERS, timeout=timeout)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding or resp.encoding
    urls = []
    for m in re.finditer(r'href=["\']([^"\']+)["\']', resp.text):
        href = m.group(1)
        if any(href.lower().split("?")[0].endswith(e) for e in ATTACH_EXTS):
            urls.append(urllib.parse.urljoin(page_url, href))
    return list(dict.fromkeys(urls))


def download_attachment(url: str, out_dir: str, retries: int = DOWNLOAD_RETRIES) -> str:
    """流式下载附件到 out_dir，失败重试（指数退避），返回本地路径。"""
    os.makedirs(out_dir, exist_ok=True)
    fname = urllib.parse.unquote(os.path.basename(urllib.parse.urlparse(url).path)) or "attachment"
    fname = re.sub(r"[^\w.\-\u4e00-\u9fff]", "_", fname)[:200]
    path = os.path.join(out_dir, f"{hashlib.md5(url.encode()).hexdigest()[:8]}_{fname}")
    last_exc = None
    for attempt in range(retries + 1):
        try:
            with requests.get(url, headers=HEADERS, timeout=120, stream=True) as r:
                r.raise_for_status()
                size = 0
                with open(path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1024 * 256):
                        size += len(chunk)
                        if size > MAX_ATTACHMENT_BYTES:
                            raise ValueError(f"attachment too large (> {MAX_ATTACHMENT_BYTES} bytes)")
                        f.write(chunk)
            return path
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if os.path.exists(path):
                os.remove(path)
            if attempt < retries:
                time.sleep(2 ** attempt)
    raise last_exc


def _clear_api_cache():
    """清理查询接口的 Redis 缓存（入库后数据已变化）。"""
    try:
        from cache import get_redis

        r = get_redis()
        for prefix in ("positions", "sources", "filters", "suggest", "stats",
                       "deadlines", "recommend", "cnt"):
            keys = list(r.scan_iter(match=f"{prefix}:*", count=500))
            if keys:
                r.delete(*keys)
    except Exception:  # noqa: BLE001  Redis 不可用时不影响采集
        pass


_SEARCH_TEXT_SQL = text("""
    UPDATE positions SET search_text =
        COALESCE(position_example, '') || ' ' || COALESCE(employer, '') || ' ' ||
        COALESCE(exam_type, '') || ' ' || COALESCE(exam_type_norm, '') || ' ' ||
        COALESCE(job_type, '') || ' ' || COALESCE(undergrad_major, '') || ' ' ||
        COALESCE(grad_major, '') || ' ' || COALESCE(college_major, '') || ' ' ||
        COALESCE(raw_major, '') || ' ' || COALESCE(special_requirements, '') || ' ' ||
        COALESCE(work_location, '') || ' ' || COALESCE(province, '') || ' ' ||
        COALESCE(city, '') || ' ' || COALESCE(district, '') || ' ' ||
        COALESCE(notes, '')
    WHERE id > :since_id
""")


def post_ingest(since_id: int):
    """对新增行（id > since_id）增量 normalize + 刷新 search_text + 清缓存。"""
    from etl.run_etl import step_normalize

    step_normalize(engine, dry_run=False, batch_size=5000, where=f"id > {int(since_id)}")
    with engine.begin() as conn:
        conn.execute(_SEARCH_TEXT_SQL, {"since_id": int(since_id)})
    _clear_api_cache()


def _parse_and_ingest(db: Session, fp: str, ann: Announcement, source: WatchSource) -> tuple:
    """解析单个 Excel 并入库，返回 (parsed_rows, ingested_rows)。"""
    base = os.path.basename(fp)
    if any(k in base for k in SKIP_FILE_KEYWORDS):
        return 0, 0
    df = parse_position_excel(
        fp,
        province="",
        source_url=ann.url,
        default_exam=(ann.title or "")[:200],
        job_type=(source.category if source and source.category else "其他"),
    )
    parsed = len(df)
    if parsed == 0:
        return 0, 0
    if source and source.year:
        df["year"] = source.year
    before_id = db.query(sa_func.coalesce(sa_func.max(Position.id), 0)).scalar()
    ingest_positions_df(db, df, default_year=(source.year if source and source.year else 2027))
    db.commit()
    ingested = (
        db.query(sa_func.count(Position.id)).filter(Position.id > before_id).scalar()
    )
    del df
    gc.collect()
    return parsed, ingested


def process_announcement(db: Session, ann: Announcement, source: WatchSource, run: CrawlRun):
    """处理单条公告：抓详情页 → 下载附件 → 解析入库。异常在调用方捕获。"""
    att_urls = find_attachment_urls(ann.url)
    if not att_urls:
        return  # 无职位表附件，保留 new 状态供人工审核
    processed_any = False
    att_errors = []
    for url in att_urls:
        att = db.query(Attachment).filter(Attachment.url == url).first()
        if att and att.status in ("done", "duplicate"):
            continue  # 同 URL 已处理过，不重复下载
        if att is None:
            att = Attachment(announcement_id=ann.id, url=url, status="new")
            db.add(att)
            db.commit()
        try:
            path = download_attachment(url, ATTACH_DIR)
            run.attachments_downloaded = (run.attachments_downloaded or 0) + 1
            db.commit()
            digest = _sha256_file(path)
            att.sha256 = digest
            att.file_name = os.path.basename(path)
            att.size_bytes = os.path.getsize(path)
            dup = (
                db.query(Attachment.id)
                .filter(Attachment.sha256 == digest, Attachment.id != att.id,
                        Attachment.status.in_(("done", "duplicate")))
                .first()
            )
            if dup:
                att.status = "duplicate"
                db.commit()
                os.remove(path)
                processed_any = True
                continue
            files = []
            if path.lower().endswith(".zip"):
                files = [
                    f for f in extract_zip(path, ATTACH_DIR, prefix=f"ann{ann.id}_att{att.id}")
                    if f.lower().endswith((".xls", ".xlsx"))
                ]
            elif path.lower().endswith((".xls", ".xlsx")):
                files = [path]
            parsed_total, ingested_total = 0, 0
            for fp in files:
                p, n = _parse_and_ingest(db, fp, ann, source)
                parsed_total += p
                ingested_total += n
            att.parsed_rows = parsed_total
            att.ingested_rows = ingested_total
            att.status = "done"
            run.rows_parsed = (run.rows_parsed or 0) + parsed_total
            run.rows_ingested = (run.rows_ingested or 0) + ingested_total
            db.commit()
            processed_any = True
        except Exception as exc:  # noqa: BLE001  单个附件失败不影响同公告其他附件
            db.rollback()
            att = db.query(Attachment).filter(Attachment.url == url).first()
            if att:
                att.status = "error"
                att.error = str(exc)[:2000]
                db.commit()
            att_errors.append(f"{url}: {exc}")
    if att_errors:
        raise RuntimeError("; ".join(att_errors)[:2000])
    if processed_any:
        ann.status = "processed"
        db.commit()


def run_source_pipeline(db: Session, source: WatchSource) -> dict:
    """对单个来源执行完整采集闭环，记录 CrawlRun。"""
    run = CrawlRun(source_id=source.id, status="running")
    db.add(run)
    db.commit()
    errors = []
    since_id = db.query(sa_func.coalesce(sa_func.max(Position.id), 0)).scalar()
    try:
        result = collector.check_source(db, source)
        run.announcements_found = result.get("new", 0)
        db.commit()
        anns = (
            db.query(Announcement)
            .filter(Announcement.source_id == source.id, Announcement.status == "new")
            .order_by(Announcement.id)
            .all()
        )
        for ann in anns:
            try:
                process_announcement(db, ann, source, run)
            except Exception as exc:  # noqa: BLE001  单条公告失败不中断其他公告
                db.rollback()
                ann = db.get(Announcement, ann.id)
                if ann:
                    ann.status = "error"
                    db.commit()
                errors.append(f"announcement#{ann.id if ann else '?'}: {exc}")
        if (run.rows_ingested or 0) > 0:
            post_ingest(since_id)
        run.status = "partial" if errors and (run.rows_ingested or 0) > 0 else (
            "error" if errors else "success"
        )
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run = db.get(CrawlRun, run.id)
        run.status = "error"
        errors.append(str(exc))
    run.error = "; ".join(errors)[:4000] if errors else None
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    return {
        "source": source.name,
        "status": run.status,
        "announcements_found": run.announcements_found,
        "attachments_downloaded": run.attachments_downloaded,
        "rows_parsed": run.rows_parsed,
        "rows_ingested": run.rows_ingested,
    }


def run_due_pipelines(db: Session) -> list:
    """对所有到期启用的来源执行采集闭环（Celery beat 每日调用）。"""
    Base.metadata.create_all(bind=engine)
    now = datetime.now(timezone.utc)
    results = []
    for src in db.query(WatchSource).filter(WatchSource.enabled == 1).all():
        due = (
            src.last_checked_at is None
            or (now - src.last_checked_at).total_seconds() >= (src.interval_minutes or 60) * 60
        )
        if due:
            results.append(run_source_pipeline(db, src))
    return results
