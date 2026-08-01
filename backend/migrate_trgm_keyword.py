#!/usr/bin/env python3
"""为 positions 关键词搜索建 pg_trgm GIN 索引（幂等，可在线执行）。

关键词搜索走 search_text 聚合列（含单位/岗位名等最常搜字段），
此处确保其 trigram 索引存在且有效；CONCURRENTLY 不锁写，
并把 maintenance_work_mem 限在 64MB 以内以适配 2GB 内存服务器。

服务器执行：cd backend && python migrate_trgm_keyword.py
"""
import os

from sqlalchemy import create_engine, text

DB_URL = os.getenv("DATABASE_URL", "postgresql://recruit:recruit@localhost:5432/recruit")

INDEXES = [
    ("idx_pos_search_text", "positions", "search_text"),
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
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        conn.execute(text("SET maintenance_work_mem = '64MB'"))
        conn.execute(text("SET statement_timeout = 0"))
        for name, table, column in INDEXES:
            state = index_state(conn, name)
            if state is True:
                print(f"{name}: 已存在且有效，跳过")
                continue
            if state is False:
                print(f"{name}: 存在但 invalid（上次并发建索引中断），先删除重建")
                conn.execute(text(f"DROP INDEX CONCURRENTLY IF EXISTS {name}"))
            print(f"{name}: CREATE INDEX CONCURRENTLY ON {table} USING GIN ({column} gin_trgm_ops)...")
            conn.execute(
                text(
                    f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} "
                    f"ON {table} USING GIN ({column} gin_trgm_ops)"
                )
            )
            print(f"{name}: 完成，state={index_state(conn, name)}")


if __name__ == "__main__":
    main()
