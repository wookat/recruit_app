"""push_subscriptions 增加 remind_nodes / sent_json 列（幂等，可在线执行）。"""
from sqlalchemy import text

from database import engine

DDL = [
    "ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS remind_nodes TEXT NOT NULL DEFAULT '[3]'",
    "ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS sent_json TEXT NOT NULL DEFAULT '{}'",
]


def main():
    with engine.begin() as conn:
        for ddl in DDL:
            conn.execute(text(ddl))
    print("done: push_subscriptions.remind_nodes / sent_json 已就绪")


if __name__ == "__main__":
    main()
