"""R284 P1-1：中国公共招聘网源「央企/国企」误标私企岗清理。

该源经济类型（国有全资/国有独资等）为单位自报，抽查发现大量明显私企
（宠物用品/水泥厂/酒店等）被打上 job_type='央企/国企' 进入体制内板块。

口径（soe_name_rules.classify_soe_name 单位名三档判定，零覆盖+审计留存）：
- soe：白名单命中，保持不动；
- private：明显私企特征，软删（invalid_reason='r284_ncss_private'，
  保留行防重新入库，旧值写 data_fix_audit，可回滚）；
- unknown：拿不准，不动，逐单位列出供人工复核。

用法：
    python scripts/fix_ncss_soe_r284.py           # 干跑
    python scripts/fix_ncss_soe_r284.py --apply   # 执行并写审计
"""
import argparse
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402

import cache  # noqa: E402
from database import engine  # noqa: E402
from soe_name_rules import classify_soe_name  # noqa: E402

RUN_TAG = "r284_ncss_private"

AUDIT_DDL = """
CREATE TABLE IF NOT EXISTS data_fix_audit (
    id bigserial PRIMARY KEY,
    run_tag varchar(60) NOT NULL,
    table_name varchar(60) NOT NULL,
    row_id integer NOT NULL,
    field varchar(60) NOT NULL,
    old_value text,
    new_value text,
    reason varchar(200),
    created_at timestamptz NOT NULL DEFAULT now()
)
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="实际执行（默认干跑）")
    args = parser.parse_args()

    with engine.connect() as conn:
        conn.execute(text("SET statement_timeout = 0"))
        conn.execute(text(AUDIT_DDL))
        conn.commit()
        rows = conn.execute(text(
            "SELECT id, employer FROM positions"
            " WHERE exam_type LIKE '%中国公共招聘网%' AND job_type = '央企/国企'"
            "   AND dup_of_id IS NULL AND invalid_reason IS NULL"
        )).fetchall()

        buckets: dict = {"soe": [], "private": [], "unknown": []}
        for rid, emp in rows:
            buckets[classify_soe_name(emp or "")].append((rid, emp))

        print(f"范围：{len(rows)} 行  ->  保留 soe={len(buckets['soe'])}"
              f"  软删 private={len(buckets['private'])}"
              f"  不动 unknown={len(buckets['unknown'])}")

        print("\n== unknown（拿不准，不动，供人工复核）按单位聚合 ==")
        for emp, n in Counter(e for _, e in buckets["unknown"]).most_common():
            print(f"  {emp}  x{n}")

        if not args.apply:
            print("\n干跑结束（未写库）。加 --apply 实际执行。")
            return

        priv = buckets["private"]
        if priv:
            conn.execute(text(
                "INSERT INTO data_fix_audit (run_tag, table_name, row_id, field,"
                " old_value, new_value, reason)"
                " VALUES (:tag, 'positions', :rid, 'invalid_reason', NULL,"
                " :new, :r)"
            ), [{"tag": RUN_TAG, "rid": rid, "new": RUN_TAG,
                 "r": f"P1-1 公共招聘网私企误标央企/国企软删（{emp}）"[:200]}
                for rid, emp in priv])
            conn.execute(text(
                "UPDATE positions SET invalid_reason = :tag"
                " WHERE id = ANY(:ids) AND invalid_reason IS NULL"
            ), {"tag": RUN_TAG, "ids": [rid for rid, _ in priv]})
        conn.commit()
        n = cache.invalidate_prefixes(
            "positions", "filters", "stats", "jobs", "jobs_filters",
            "cnt", "items", "seo_index", "seo_prov", "seo_prov_et",
            "seo_city", "seo_city_et", "seo_topic_counts", "seo_topic_index",
            "seo_topic", "seo_rank_stats", "seo_sbx_stats", "seo_rank_index",
            "seo_rank_shangan", "seo_rank_sanbuxian", "seo_feed")
        print(f"\n已软删 {len(priv)} 行；缓存失效 {n} 键。")
        print("请随后执行 refresh_unified_jobs（物化视图刷新）+ warm 预热。")


if __name__ == "__main__":
    main()
