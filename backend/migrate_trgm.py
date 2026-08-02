#!/usr/bin/env python3
"""为三板块关键词搜索的全部 ILIKE 涉及列建 pg_trgm GIN 索引（幂等，可在线执行）。

- positions 走 search_text 聚合列（含单位/岗位名等最常搜字段）；
- campus_jobs / bianzhi_jobs 的关键词 OR 匹配各列分别建索引，
  Postgres 以 BitmapOr 组合多列 trgm 位图扫描；
- CONCURRENTLY 不锁写，逐个建；maintenance_work_mem 临时调至 128MB
  （仅本会话）以适配 2GB 内存服务器。

服务器执行：cd backend && python migrate_trgm.py
"""
import os

from sqlalchemy import create_engine, text

DB_URL = os.getenv("DATABASE_URL", "postgresql://recruit:recruit@localhost:5432/recruit")

# 自建 2-gram：2 字中文关键词无法提取 trigram，pg_trgm 索引帮不到；
# 用 IMMUTABLE 函数生成 bigram text[] 建表达式 GIN 索引，
# 查询侧 bigrams(col) @> ARRAY[..] 预过滤 + 原 ILIKE 精确校验（结果集不变）。
# 仅覆盖分层查询 tier1/tier2 的短列，不对超长 search_text 建（体积不可控）。
BIGRAM_FUNCTION = """
CREATE OR REPLACE FUNCTION bigrams(txt text) RETURNS text[] AS $$
SELECT COALESCE(array_agg(DISTINCT substr(lower(txt), i, 2)), '{}'::text[])
FROM generate_series(1, greatest(length(txt) - 1, 0)) AS i
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE
"""

# (name, table, 定义 SQL 片段)
BTREE_INDEXES = [
    # 关键词分层查询按 year DESC, id DESC 提前终止：单列 year 索引下
    # incremental sort 需读完整个年份组才能按 id 排序，复合索引免排序早停
    ("idx_pos_year_id", "positions", "USING BTREE (year, id)"),
    ("idx_pos_position_bigrams", "positions", "USING GIN (bigrams(position_example))"),
    ("idx_pos_employer_bigrams", "positions", "USING GIN (bigrams(employer))"),
    # tier3/count 兜底列：本地实测体积 321MB、建索引 ~28min（128MB maintenance_work_mem）
    ("idx_pos_search_text_bigrams", "positions", "USING GIN (bigrams(search_text))"),
]

INDEXES = [
    ("idx_pos_search_text", "positions", "search_text"),
    ("idx_campus_company_trgm", "campus_jobs", "company"),
    ("idx_campus_positions_trgm", "campus_jobs", "positions"),
    ("idx_campus_industry_trgm", "campus_jobs", "industry"),
    ("idx_campus_major_req_trgm", "campus_jobs", "major_requirement"),
    ("idx_bianzhi_employer_trgm", "bianzhi_jobs", "employer"),
    ("idx_bianzhi_work_location_trgm", "bianzhi_jobs", "work_location"),
    ("idx_bianzhi_major_req_trgm", "bianzhi_jobs", "major_requirement"),
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
        conn.execute(text("SET maintenance_work_mem = '128MB'"))
        conn.execute(text("SET statement_timeout = 0"))
        conn.execute(text(BIGRAM_FUNCTION))
        print("bigrams(text) 函数已创建/更新")
        for name, table, definition in BTREE_INDEXES:
            state = index_state(conn, name)
            if state is True:
                print(f"{name}: 已存在且有效，跳过")
                continue
            if state is False:
                print(f"{name}: 存在但 invalid，先删除重建")
                conn.execute(text(f"DROP INDEX CONCURRENTLY IF EXISTS {name}"))
            print(f"{name}: CREATE INDEX CONCURRENTLY ON {table} {definition}...")
            conn.execute(
                text(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} {definition}")
            )
            print(f"{name}: 完成，state={index_state(conn, name)}")
            conn.execute(text(f"ANALYZE {table}"))
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
