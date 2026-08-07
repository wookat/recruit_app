"""近 N 天日趋势聚合（/api/recent-updates）索引：三板块 created_at btree，
让按入库时间的日分组聚合与单日样例查询走索引扫描而非全表扫描。"""
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from database import engine

STATEMENTS = [
    # 清洗后行按入库时间：日趋势聚合 + 单日样例
    """CREATE INDEX IF NOT EXISTS idx_pos_clean_created_at
       ON positions (created_at)
       WHERE dup_of_id IS NULL AND invalid_reason IS NULL""",
    """CREATE INDEX IF NOT EXISTS idx_campus_created_at
       ON campus_jobs (created_at)""",
    """CREATE INDEX IF NOT EXISTS idx_bianzhi_created_at
       ON bianzhi_jobs (created_at)""",
]


def main():
    with engine.connect() as conn:
        conn.execute(text("SET statement_timeout = 0"))
        for stmt in STATEMENTS:
            print(stmt.split("\n")[0].strip())
            try:
                conn.execute(text(stmt))
                conn.commit()
            except ProgrammingError as exc:  # 本地精简库可能缺表
                print(f"  skipped: {exc.orig}")
                conn.rollback()
    print("done")


if __name__ == "__main__":
    main()
