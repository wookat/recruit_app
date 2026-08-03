"""一次性清理 campus_jobs 跨来源重复记录。

按 import_campus.cross_hash（公司+岗位+批次+届次+链接，忽略分隔符/空白差异）
分组，每组保留最小 id，删除其余。默认 dry-run，只统计不删除；
传 --apply 才真正删除。
"""
import sys

from sqlalchemy import text

from database import SessionLocal
from import_campus import cross_hash


def main() -> None:
    apply = "--apply" in sys.argv
    db = SessionLocal()
    try:
        rows = db.execute(text(
            "SELECT id, company, positions, batch, grad_years, apply_url, announce_url"
            " FROM campus_jobs ORDER BY id"
        )).fetchall()
        keep: dict[str, int] = {}
        dups: list[int] = []
        for r in rows:
            xh = cross_hash(r[1], r[2], r[3], r[4], r[5], r[6])
            if xh in keep:
                dups.append(r[0])
            else:
                keep[xh] = r[0]
        print(f"总行数 {len(rows)}，唯一 {len(keep)}，重复待删 {len(dups)}")
        if not apply:
            print("dry-run：未删除。加 --apply 执行删除。")
            return
        for i in range(0, len(dups), 500):
            batch = dups[i:i + 500]
            db.execute(text("DELETE FROM campus_jobs WHERE id = ANY(:ids)"), {"ids": batch})
        db.commit()
        print(f"已删除 {len(dups)} 条重复记录。")
    finally:
        db.close()


if __name__ == "__main__":
    main()
