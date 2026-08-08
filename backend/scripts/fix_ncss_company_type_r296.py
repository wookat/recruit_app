"""R296 P2-1：campus_jobs NCSS 源自报「国有企业」中人工复核确认的私企重分类。

背景：NCSS 自报 company_type='国有企业' 的行中，soe_name_rules 启发式判
private/unknown 占比高。R296 抽 30 条「判 private」+30 条「判 unknown」
对照工商信息人工复核（docs/research/r296-ncss-company-type-review.md），
结论：启发式判 private 的误报率过高（约 70% 实为国资/国有控股），
不得按启发式批量重分类；仅对复核确认股权为民营/非国资的单位白名单
执行 company_type 重分类（旧值写 data_fix_audit，可回滚），其余一律不动。

用法：
    python scripts/fix_ncss_company_type_r296.py           # 干跑
    python scripts/fix_ncss_company_type_r296.py --apply   # 执行并写审计
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402

import cache  # noqa: E402
from database import engine  # noqa: E402

RUN_TAG = "r296_ncss_company_type"
NEW_TYPE = "民营企业"

# 人工复核确认为民营（工商股权无国资控股）的单位（详见复核报告）
CONFIRMED_PRIVATE = [
    "湖州长兴磁通电子科技有限公司",   # 自然人股东 65%/35%
    "浙江海利得酒店管理有限公司",     # 海利得新材料（民营上市 002206）100%
    "西充金领莲花大酒店有限公司",     # 源页自标民营企业
    "湖州志辉科技股份有限公司",       # 自然人股东 44%/44%/12%
    "山东海盛海洋工程集团有限公司",   # 17 名自然人股东
    "浙江碧桂园管理咨询有限公司",     # 碧桂园系 90%
    "联奕测试",                       # 华宇软件（民营上市）子公司联奕科技测试数据
]

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
            "SELECT id, company, company_type FROM campus_jobs"
            " WHERE source_table = 'NCSS' AND company_type = '国有企业'"
            "   AND company = ANY(:names)"
        ), {"names": CONFIRMED_PRIVATE}).fetchall()

        print(f"待重分类：{len(rows)} 行（{len(CONFIRMED_PRIVATE)} 家复核确认单位）")
        for rid, comp, ct in rows:
            print(f"  id={rid}  {comp}  {ct} -> {NEW_TYPE}")

        if not args.apply:
            print("\n干跑结束（未写库）。加 --apply 实际执行。")
            return
        if not rows:
            print("无匹配行。")
            return

        conn.execute(text(
            "INSERT INTO data_fix_audit (run_tag, table_name, row_id, field,"
            " old_value, new_value, reason)"
            " VALUES (:tag, 'campus_jobs', :rid, 'company_type', :old, :new, :r)"
        ), [{"tag": RUN_TAG, "rid": rid, "old": ct, "new": NEW_TYPE,
             "r": f"P2-1 NCSS 自报国企经工商复核为民营（{comp}）"[:200]}
            for rid, comp, ct in rows])
        conn.execute(text(
            "UPDATE campus_jobs SET company_type = :new"
            " WHERE id = ANY(:ids) AND company_type = '国有企业'"
        ), {"new": NEW_TYPE, "ids": [rid for rid, _, _ in rows]})
        conn.commit()
        n = cache.invalidate_prefixes(
            "campus_filters", "campus_counts", "campus_timeline",
            "seo_topic_counts", "seo_topic_index", "seo_topic")
        print(f"\n已重分类 {len(rows)} 行；缓存失效 {n} 键。")


if __name__ == "__main__":
    main()
