#!/usr/bin/env python3
"""搜索联想（/api/suggest）单位/公司名前缀匹配索引（幂等，可在线执行）。

lower(col) LIKE 'q%' 前缀查询走 text_pattern_ops 表达式 BTREE 索引，
避免 97 万行全表 ILIKE 扫描；CONCURRENTLY 不锁写。

服务器执行：cd backend && python migrate_suggest.py
"""
import os

from sqlalchemy import create_engine, text

DB_URL = os.getenv("DATABASE_URL", "postgresql://recruit:recruit@localhost:5432/recruit")

INDEXES = [
    ("idx_pos_employer_prefix", "positions", "lower(employer) text_pattern_ops"),
    ("idx_campus_company_prefix", "campus_jobs", "lower(company) text_pattern_ops"),
    ("idx_bianzhi_employer_prefix", "bianzhi_jobs", "lower(employer) text_pattern_ops"),
]


def index_state(conn, name: str):
    """返回 None（不存在）/ True（有效）/ False（存在但 invalid，需重建）。"""
    row = conn.execute(
        text(
            """
            SELECT i.indisvalid
            FROM pg_class c
            JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = :name
            """
        ),
        {"name": name},
    ).first()
    return None if row is None else bool(row[0])


def main():
    # CONCURRENTLY 必须在自动提交模式下执行
    engine = create_engine(DB_URL, future=True, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        conn.execute(text("SET maintenance_work_mem = '128MB'"))
        conn.execute(text("SET statement_timeout = 0"))
        for name, table, definition in INDEXES:
            if conn.execute(text("SELECT to_regclass(:t)"), {"t": table}).scalar() is None:
                print(f"{name}: 表 {table} 不存在，跳过")
                continue
            state = index_state(conn, name)
            if state is True:
                print(f"{name}: 已存在且有效，跳过")
                continue
            if state is False:
                print(f"{name}: 存在但 invalid，先删除重建")
                conn.execute(text(f"DROP INDEX CONCURRENTLY IF EXISTS {name}"))
            print(f"{name}: CREATE INDEX CONCURRENTLY ON {table} ({definition})...")
            conn.execute(
                text(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} ({definition})")
            )
            print(f"{name}: 完成，state={index_state(conn, name)}")
            conn.execute(text(f"ANALYZE {table}"))


if __name__ == "__main__":
    main()
