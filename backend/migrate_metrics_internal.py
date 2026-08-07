"""metrics 数据可信度迁移（R286，幂等，可在线执行）：

1. metrics_pv_daily / metrics_sessions_daily / metrics_job_view_daily 加 internal 列，
   pv/job_view 的唯一约束改为含 internal（internal 行与真实行分开累加）；
2. 建 metrics_event_daily（事件 × sid，漏斗可测）与 metrics_request_log（ip_hash/ua 审计）；
3. 历史清洗：按上线时间线识别可确认的 QA 污染行标 internal=true——
   - 8/3–8/4 全量（?qa=1 排除机制 8/5 23:59 UTC 才部署，R285 已证实该两日为 QA 走查峰值）；
   - board='event' 的既有行（R285 判定为 QA 冒烟产物：各事件恰 1–2 次且集中在功能上线当天）。
   8/5 起的混合流量无 ip/ua 留存、无法逐行区分，如实保留（internal=false）。
"""
from sqlalchemy import text

from database import Base, engine
from models import MetricEventDaily, MetricRequestLog

QA_POLLUTED_DAYS = ("2026-08-03", "2026-08-04")

DDL = [
    "ALTER TABLE metrics_pv_daily ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false",
    "ALTER TABLE metrics_sessions_daily ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false",
    "ALTER TABLE metrics_job_view_daily ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false",
    "ALTER TABLE metrics_pv_daily DROP CONSTRAINT IF EXISTS uq_pv_day_board_page",
    """DO $$ BEGIN
        ALTER TABLE metrics_pv_daily
            ADD CONSTRAINT uq_pv_day_board_page_int UNIQUE (day, board, page, internal);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$""",
    "ALTER TABLE metrics_job_view_daily DROP CONSTRAINT IF EXISTS uq_jobview_day_board_job",
    """DO $$ BEGIN
        ALTER TABLE metrics_job_view_daily
            ADD CONSTRAINT uq_jobview_day_board_job_int UNIQUE (day, board, job_id, internal);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$""",
]

BACKFILL = [
    "UPDATE metrics_pv_daily SET internal = true WHERE day = ANY(:days ::date[]) AND NOT internal",
    "UPDATE metrics_sessions_daily SET internal = true WHERE day = ANY(:days ::date[]) AND NOT internal",
    "UPDATE metrics_pv_daily SET internal = true WHERE board = 'event' AND day <= '2026-08-07' AND NOT internal",
]


def main():
    Base.metadata.create_all(
        bind=engine, tables=[MetricEventDaily.__table__, MetricRequestLog.__table__]
    )
    with engine.connect() as conn:
        for ddl in DDL:
            conn.execute(text(ddl))
        for sql in BACKFILL:
            n = conn.execute(text(sql), {"days": list(QA_POLLUTED_DAYS)}).rowcount
            print(f"backfill: {n} rows — {sql[:60]}...")
        conn.commit()
    print("done: metrics internal 迁移完成")


if __name__ == "__main__":
    main()
