"""R307 跨板块双挂去重 + campus 无入口链接行软删（配合 R306 审计报告 P2-1/P3-4）。

P2-1 positions「国企校园招聘」批次与 campus_jobs 国聘源跨板块双挂：
- 只处理「严格重复」：单位+岗位名+截止日+工作地点全同（执行时同时要求
  source_url = announce_url 双保险，审计抽样中严格组 URL 100% 相同）；
- positions 侧打 cross_board_dup 标（不软删，positions 板块继续展示），
  unified_jobs 刷新时排除打标行，保留 campus 侧（国聘为其原生源、字段更全）；
- 模糊组（单位+岗位名+截止日同但地点不同）一律不动，只打印数量。

P3-4 campus announce_url/apply_url 双空且无内推码/备注/岗位名的行软删
（invalid_reason='r307_no_entry'，保留 content_hash 防重新入库）。

全部旧值写 data_fix_audit（run_tag=r307_cross_board_dup / r307_no_entry），
并导出 JSONL 审计文件。

用法：
    python scripts/fix_cross_board_dup_r307.py                # 干跑，只打印计数
    python scripts/fix_cross_board_dup_r307.py --apply        # 实际执行并写审计
    python scripts/fix_cross_board_dup_r307.py --apply --jsonl /tmp/r307_audit.jsonl
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402

import cache  # noqa: E402
from database import engine  # noqa: E402

TAG_DUP = "r307_cross_board_dup"
TAG_NO_ENTRY = "r307_no_entry"

STRICT_MATCH_SQL = """
SELECT DISTINCT p.id, p.employer, p.position_example,
       p.signup_deadline::date AS deadline, p.work_location, p.source_url,
       c.id AS campus_id
FROM positions p
JOIN campus_jobs c
  ON c.company = p.employer
 AND c.positions = p.position_example
 AND c.deadline_date = p.signup_deadline::date
 AND c.locations = p.work_location
 AND c.announce_url = p.source_url
 AND c.invalid_reason IS NULL
WHERE p.exam_type LIKE '%国企校园招聘%'
  AND p.dup_of_id IS NULL AND p.invalid_reason IS NULL
  AND NOT p.cross_board_dup
"""

FUZZY_COUNT_SQL = """
SELECT count(DISTINCT p.id)
FROM positions p
JOIN campus_jobs c
  ON c.company = p.employer
 AND c.positions = p.position_example
 AND c.deadline_date = p.signup_deadline::date
 AND c.invalid_reason IS NULL
WHERE p.exam_type LIKE '%国企校园招聘%'
  AND p.dup_of_id IS NULL AND p.invalid_reason IS NULL
  AND NOT p.cross_board_dup
  AND (coalesce(c.locations, '') <> coalesce(p.work_location, '')
       OR coalesce(c.announce_url, '') <> coalesce(p.source_url, ''))
"""

NO_ENTRY_SQL = """
SELECT id, company, source_table
FROM campus_jobs
WHERE invalid_reason IS NULL
  AND coalesce(announce_url, '') = '' AND coalesce(apply_url, '') = ''
  AND coalesce(referral_code, '') = '' AND coalesce(notes, '') = ''
  AND coalesce(positions, '') = ''
"""

AUDIT_INSERT = text(
    "INSERT INTO data_fix_audit (run_tag, table_name, row_id, field,"
    " old_value, new_value, reason) VALUES (:tag, :tb, :rid, :f, :old, :new, :r)"
)


def fix_p21_cross_board(conn, apply, jsonl_rows):
    has_col = conn.execute(text(
        "SELECT 1 FROM information_schema.columns"
        " WHERE table_name = 'positions' AND column_name = 'cross_board_dup'"
    )).scalar()
    if not has_col:
        # ALTER 需 AccessExclusive 锁，设 lock_timeout 防止排队阻塞线上查询
        conn.execute(text("SET lock_timeout = '5s'"))
        conn.execute(text(
            "ALTER TABLE positions ADD COLUMN IF NOT EXISTS"
            " cross_board_dup boolean NOT NULL DEFAULT false"
        ))
        conn.commit()
        conn.execute(text("SET lock_timeout = 0"))
    rows = conn.execute(text(STRICT_MATCH_SQL)).mappings().all()
    fuzzy = conn.execute(text(FUZZY_COUNT_SQL)).scalar() or 0
    groups = len({(r["employer"], r["position_example"], r["deadline"]) for r in rows})
    print(f"P2-1 严格重复（单位+岗位名+截止日+地点+URL 全同）: {len(rows)} 行 / {groups} 组")
    print(f"P2-1 模糊组（地点或 URL 不同，不动）: {fuzzy} 行")
    if apply and rows:
        conn.execute(AUDIT_INSERT, [
            {"tag": TAG_DUP, "tb": "positions", "rid": r["id"],
             "f": "cross_board_dup", "old": "false", "new": "true",
             "r": f"P2-1 与 campus id={r['campus_id']} 严格重复（国聘跨板块双挂）"}
            for r in rows])
        conn.execute(text(
            "UPDATE positions SET cross_board_dup = true WHERE id = ANY(:ids)"
        ), {"ids": [r["id"] for r in rows]})
    for r in rows:
        jsonl_rows.append({
            "run_tag": TAG_DUP, "table": "positions", "id": r["id"],
            "field": "cross_board_dup", "old": False, "new": True,
            "campus_id": r["campus_id"], "employer": r["employer"],
            "title": r["position_example"], "deadline": str(r["deadline"]),
            "work_location": r["work_location"], "url": r["source_url"],
        })
    return len(rows)


def fix_p34_no_entry(conn, apply, jsonl_rows):
    rows = conn.execute(text(NO_ENTRY_SQL)).mappings().all()
    print(f"P3-4 campus 双 URL 空且无内推码/备注/岗位名行软删: {len(rows)} 行")
    if apply and rows:
        conn.execute(AUDIT_INSERT, [
            {"tag": TAG_NO_ENTRY, "tb": "campus_jobs", "rid": r["id"],
             "f": "invalid_reason", "old": None, "new": TAG_NO_ENTRY,
             "r": "P3-4 无任何入口链接且无内推码/备注/岗位名"}
            for r in rows])
        conn.execute(text(
            "UPDATE campus_jobs SET invalid_reason = :v WHERE id = ANY(:ids)"
        ), {"v": TAG_NO_ENTRY, "ids": [r["id"] for r in rows]})
    for r in rows:
        jsonl_rows.append({
            "run_tag": TAG_NO_ENTRY, "table": "campus_jobs", "id": r["id"],
            "field": "invalid_reason", "old": None, "new": TAG_NO_ENTRY,
            "company": r["company"], "source_table": r["source_table"],
        })
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="实际执行（默认干跑）")
    parser.add_argument("--jsonl", default="", help="JSONL 审计文件输出路径")
    args = parser.parse_args()

    jsonl_rows: list = []
    with engine.connect() as conn:
        conn.execute(text("SET statement_timeout = 0"))
        n1 = fix_p21_cross_board(conn, args.apply, jsonl_rows)
        n2 = fix_p34_no_entry(conn, args.apply, jsonl_rows)
        if args.apply:
            conn.commit()
            n = cache.invalidate_prefixes(
                "jobs", "jobs_filters", "campus_counts", "campus_filters",
                "campus_timeline", "stats", "filters", "freshness", "recent_updates")
            print(f"缓存失效: {n} 键")
            print("完成。请随后执行 refresh_unified_jobs（视图定义已改，需重建）。")
        else:
            conn.rollback()
            print("干跑结束（未写库）。加 --apply 实际执行。")
    if args.jsonl:
        with open(args.jsonl, "w", encoding="utf-8") as f:
            for row in jsonl_rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"JSONL 审计: {args.jsonl}（{len(jsonl_rows)} 行）")
    print(f"summary: cross_board_dup={n1} no_entry={n2}")


if __name__ == "__main__":
    main()
