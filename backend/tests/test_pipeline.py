# -*- coding: utf-8 -*-
"""D1 采集闭环集成自测（需本地 postgres + redis）。

用小样本附件模拟：本地 HTTP 服务器提供 索引页 → 公告页 → xlsx 职位表附件，
验证 公告发现 → 附件下载去重 → 解析 → 入库 → crawl_runs 记录 全流程。

用法: cd backend && python tests/test_pipeline.py
"""
import http.server
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from openpyxl import Workbook
from sqlalchemy import text

import pipeline
from database import Base, SessionLocal, engine
from models import Announcement, Attachment, CrawlRun, Position, WatchSource

PORT = 8765
DOCROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def build_fixtures():
    os.makedirs(DOCROOT, exist_ok=True)
    wb = Workbook()
    ws = wb.active
    ws.append(["单位名称", "职位名称", "招考人数", "学历要求", "专业要求", "工作地点", "其他条件"])
    ws.append(["测试市财政局", "综合管理岗", "2", "本科及以上", "会计学、财政学", "测试市", "应届毕业生"])
    ws.append(["测试市税务局", "税收征管岗", "1", "硕士研究生", "税务、经济学", "测试市", ""])
    wb.save(os.path.join(DOCROOT, "positions_2027.xlsx"))
    with open(os.path.join(DOCROOT, "index.html"), "w", encoding="utf-8") as f:
        f.write('<html><body><a href="/ann.html">2027年度测试市公务员考试录用职位公告</a></body></html>')
    with open(os.path.join(DOCROOT, "ann.html"), "w", encoding="utf-8") as f:
        f.write('<html><body>附件：<a href="/positions_2027.xlsx">职位表.xlsx</a></body></html>')
    with open(os.path.join(DOCROOT, "index_bad.html"), "w", encoding="utf-8") as f:
        f.write('<html><body><a href="/ann_bad.html">2027年度坏附件市公务员考试录用职位公告</a></body></html>')
    with open(os.path.join(DOCROOT, "ann_bad.html"), "w", encoding="utf-8") as f:
        f.write('<html><body>附件：<a href="/missing_positions.xlsx">职位表.xlsx</a></body></html>')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DOCROOT, **kwargs)

    def log_message(self, *args):
        pass


def reset_db(db):
    db.query(Announcement).delete()
    db.query(Attachment).delete()
    db.query(CrawlRun).delete()
    db.query(WatchSource).delete()
    db.query(Position).filter(Position.source_url.like(f"http://127.0.0.1:{PORT}/%")).delete(
        synchronize_session=False
    )
    db.commit()


def main():
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    Base.metadata.create_all(bind=engine)
    build_fixtures()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    db = SessionLocal()
    try:
        reset_db(db)
        src = WatchSource(
            name="测试市2027省考",
            index_url=f"http://127.0.0.1:{PORT}/index.html",
            keywords="2027,职位",
            category="公务员",
            year=2027,
            enabled=1,
            interval_minutes=60,
        )
        bad = WatchSource(
            name="坏附件市2027省考",
            index_url=f"http://127.0.0.1:{PORT}/index_bad.html",
            keywords="2027,职位",
            category="公务员",
            year=2027,
            enabled=1,
            interval_minutes=60,
        )
        db.add_all([src, bad])
        db.commit()

        # --- 第一次运行：公告发现 + 附件下载 + 解析入库 ---
        results = pipeline.run_due_pipelines(db)
        print("run1:", results)
        by_name = {r["source"]: r for r in results}
        r1 = by_name["测试市2027省考"]
        assert r1["status"] == "success", r1
        assert r1["announcements_found"] == 1
        assert r1["attachments_downloaded"] == 1
        assert r1["rows_parsed"] == 2
        assert r1["rows_ingested"] == 2

        ann = db.query(Announcement).filter(Announcement.source_id == src.id).one()
        assert ann.status == "processed", ann.status
        att = db.query(Attachment).filter(Attachment.announcement_id == ann.id).one()
        assert att.status == "done" and len(att.sha256) == 64, (att.status, att.sha256)
        pos = db.query(Position).filter(Position.source_url == ann.url).all()
        assert len(pos) == 2
        assert all(p.year == 2027 and p.search_text for p in pos)
        assert all(p.content_hash_v2 for p in pos)

        # --- 失败路径：附件 404 → 公告 error，附件 error，运行 error ---
        rbad = by_name["坏附件市2027省考"]
        assert rbad["status"] == "error", rbad
        ann_bad = db.query(Announcement).filter(Announcement.source_id == bad.id).one()
        assert ann_bad.status == "error", ann_bad.status
        att_bad = db.query(Attachment).filter(Attachment.announcement_id == ann_bad.id).one()
        assert att_bad.status == "error" and att_bad.error

        # --- 第二次运行：URL 去重，不重复下载/入库 ---
        src.last_checked_at = None
        ann.status = "new"  # 即使公告被重置，也不应重复下载同一附件
        db.commit()
        results2 = pipeline.run_due_pipelines(db)
        print("run2:", results2)
        r2 = {r["source"]: r for r in results2}["测试市2027省考"]
        assert r2["attachments_downloaded"] == 0, r2
        assert r2["rows_ingested"] == 0, r2
        assert db.query(Position).filter(Position.source_url == ann.url).count() == 2
        assert db.query(Attachment).count() == 2  # 无新附件记录

        # --- SHA256 去重：同内容不同 URL 只解析一次 ---
        with open(os.path.join(DOCROOT, "ann.html"), "w", encoding="utf-8") as f:
            f.write('<html><body><a href="/positions_2027.xlsx?v=2">职位表.xlsx</a></body></html>')
        db.query(Announcement).filter(Announcement.id == ann.id).update({"status": "new"})
        src.last_checked_at = None
        db.commit()
        results3 = pipeline.run_due_pipelines(db)
        print("run3:", results3)
        r3 = {r["source"]: r for r in results3}["测试市2027省考"]
        assert r3["rows_ingested"] == 0, r3
        att_dup = db.query(Attachment).filter(Attachment.url.like("%v=2")).one()
        assert att_dup.status == "duplicate", att_dup.status
        assert db.query(Position).filter(Position.source_url == ann.url).count() == 2

        print("ALL PIPELINE TESTS PASSED")
    finally:
        reset_db(db)
        db.close()
        server.shutdown()


if __name__ == "__main__":
    main()
