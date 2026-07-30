"""性能索引：为清洗后行（dup_of_id IS NULL AND invalid_reason IS NULL）
建立部分索引，加速列表页 count(*) 与常用过滤组合。"""
from sqlalchemy import text

from database import engine

STATEMENTS = [
    # 清洗后行的覆盖部分索引：count(*)/游标分页走 index-only scan
    """CREATE INDEX IF NOT EXISTS idx_pos_clean_year_id
       ON positions (year DESC, id DESC)
       WHERE dup_of_id IS NULL AND invalid_reason IS NULL""",
    # 常用过滤：清洗后行按 job_type
    """CREATE INDEX IF NOT EXISTS idx_pos_clean_job_year
       ON positions (job_type, year)
       WHERE dup_of_id IS NULL AND invalid_reason IS NULL""",
]


def main():
    with engine.connect() as conn:
        for stmt in STATEMENTS:
            print(stmt.split("\n")[0].strip())
            conn.execute(text(stmt))
            conn.commit()
    print("done")


if __name__ == "__main__":
    main()
