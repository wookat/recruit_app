"""R273: 同批次回填 signup_time/exam_time（零外呼）。

批次判定口径（严格）：
- R1 same_source_url: 同一 source_url（每条公告一个 URL 的源，如 jingjia.org）下，
  兄弟行某字段非空且「时间样式」值全局唯一（distinct=1），则回填该批次内缺失该字段的行。
- R1b zgsydw_ann_link: zgsydw 行以 notes 中「公告链接：<url>」为批次键，同上口径。
- R2 xds_province_batch: 选调生（exam_type_norm='选调生'）按 (province, year) 为批次
  （省级选调统一报名/笔试时间），donor 值全局唯一才回填。

安全约束：
- 仅当 donor 值通过时间样式校验（含数字且含 月/日/年/至/-//）才作为回填值，
  排除“职测+专业知识”等科目文本污染。
- 零覆盖：仅填 NULL/空串字段。
- 全部写入前输出审计 JSONL：{id, field, old, new, rule, batch_key, donor_rows, ts}。

用法（在 recruit-app 容器内，读 DATABASE_URL）：
  python scripts/backfill_batch_times_r273.py --limit 500          # 试点 dry-run 计划
  python scripts/backfill_batch_times_r273.py --limit 500 --execute
  python scripts/backfill_batch_times_r273.py --execute            # 全量
"""

import argparse
import json
import os
import re
import time

import psycopg2

TIME_RE_DIGIT = re.compile(r"[0-9０-９]")
TIME_RE_MARK = re.compile(r"[月日年]|至|-|/")

AUDIT_DIR = "/tmp/r273_audit"


def is_time_like(v: str) -> bool:
    return bool(v) and bool(TIME_RE_DIGIT.search(v)) and bool(TIME_RE_MARK.search(v))


BASE_FILTER = "dup_of_id IS NULL AND invalid_reason IS NULL"


def collect_r1(cur, field):
    cur.execute(
        f"""
        WITH z AS (
          SELECT id, source_url AS bk, COALESCE({field},'') AS v
          FROM positions
          WHERE {BASE_FILTER} AND source_url IS NOT NULL
            AND source_url NOT LIKE '%%zgsydw%%'
        ),
        d AS (
          SELECT bk,
                 array_agg(DISTINCT v) FILTER (WHERE v <> '') AS vals,
                 count(*) FILTER (WHERE v <> '') AS donor_rows
          FROM z GROUP BY bk HAVING count(*) > 1
        )
        SELECT z.id, z.bk, d.vals[1], d.donor_rows
        FROM z JOIN d USING (bk)
        WHERE z.v = '' AND array_length(d.vals, 1) = 1
        """
    )
    return [("same_source_url", r[0], r[1], r[2], r[3]) for r in cur.fetchall()]


def collect_r1b(cur, field):
    cur.execute(
        f"""
        WITH z AS (
          SELECT id,
                 substring(notes FROM '公告链接：(https?://[^；\\s]+)') AS bk,
                 COALESCE({field},'') AS v
          FROM positions
          WHERE {BASE_FILTER} AND source_url LIKE '%%zgsydw%%'
        ),
        d AS (
          SELECT bk,
                 array_agg(DISTINCT v) FILTER (WHERE v <> '') AS vals,
                 count(*) FILTER (WHERE v <> '') AS donor_rows
          FROM z WHERE bk IS NOT NULL GROUP BY bk
        )
        SELECT z.id, z.bk, d.vals[1], d.donor_rows
        FROM z JOIN d USING (bk)
        WHERE z.v = '' AND array_length(d.vals, 1) = 1
        """
    )
    return [("zgsydw_ann_link", r[0], r[1], r[2], r[3]) for r in cur.fetchall()]


def collect_r2(cur, field):
    cur.execute(
        f"""
        WITH z AS (
          SELECT id, province || '|' || year AS bk, COALESCE({field},'') AS v
          FROM positions
          WHERE {BASE_FILTER} AND exam_type_norm = '选调生' AND province IS NOT NULL
        ),
        d AS (
          SELECT bk,
                 array_agg(DISTINCT v) FILTER (WHERE v <> '') AS vals,
                 count(*) FILTER (WHERE v <> '') AS donor_rows
          FROM z GROUP BY bk
        )
        SELECT z.id, z.bk, d.vals[1], d.donor_rows
        FROM z JOIN d USING (bk)
        WHERE z.v = '' AND array_length(d.vals, 1) = 1
        """
    )
    return [("xds_province_batch", r[0], r[1], r[2], r[3]) for r in cur.fetchall()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="试点行数上限（按 (id,field) 计）")
    ap.add_argument("--execute", action="store_true", help="实际写库（默认 dry-run）")
    args = ap.parse_args()

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()

    plans = {}  # (id, field) -> (rule, bk, value, donor_rows)
    for field in ("signup_time", "exam_time"):
        for collector in (collect_r1, collect_r1b, collect_r2):
            for rule, pid, bk, val, donor_rows in collector(cur, field):
                if not is_time_like(val):
                    continue
                plans.setdefault((pid, field), (rule, bk, val, donor_rows))

    items = sorted(plans.items())
    if args.limit:
        items = items[: args.limit]

    os.makedirs(AUDIT_DIR, exist_ok=True)
    ts = time.strftime("%Y%m%dT%H%M%S")
    mode = "exec" if args.execute else "dryrun"
    audit_path = os.path.join(AUDIT_DIR, f"backfill_batch_times_r273_{mode}_{ts}.jsonl")

    stats = {}
    with open(audit_path, "w", encoding="utf-8") as f:
        for (pid, field), (rule, bk, val, donor_rows) in items:
            rec = {
                "id": pid,
                "field": field,
                "old": "",
                "new": val,
                "rule": rule,
                "batch_key": bk,
                "donor_rows": donor_rows,
                "ts": ts,
                "executed": bool(args.execute),
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            stats[(rule, field)] = stats.get((rule, field), 0) + 1
            if args.execute:
                cur.execute(
                    f"UPDATE positions SET {field} = %s "
                    f"WHERE id = %s AND ({field} IS NULL OR {field} = '')",
                    (val, pid),
                )
    if args.execute:
        conn.commit()

    print(f"mode={mode} planned={len(items)} audit={audit_path}")
    for (rule, field), n in sorted(stats.items()):
        print(f"  {rule} {field}: {n}")


if __name__ == "__main__":
    main()
