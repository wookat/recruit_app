"""为 campus_jobs / bianzhi_jobs 增加 deadline_date DATE 可空列与索引（幂等）。"""
from sqlalchemy import text

from database import engine

STATEMENTS = [
    "ALTER TABLE campus_jobs ADD COLUMN IF NOT EXISTS deadline_date DATE",
    "ALTER TABLE bianzhi_jobs ADD COLUMN IF NOT EXISTS deadline_date DATE",
    """CREATE INDEX IF NOT EXISTS idx_campus_deadline_date
       ON campus_jobs (deadline_date) WHERE deadline_date IS NOT NULL""",
    """CREATE INDEX IF NOT EXISTS idx_bianzhi_deadline_date
       ON bianzhi_jobs (deadline_date) WHERE deadline_date IS NOT NULL""",
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
