"""R279 板块归属修复（数据侧一次性脚本，配合 R278 审计报告）。

修复项（全部零覆盖：逐行旧值写入 data_fix_audit 审计表）：
- P1-2  positions 国家能源集团系央企社招误标「事业单位/事业编」→ 改判「央企/国企」
- P2-2  campus_jobs company_type 归一（国有企业/国企/中央企业→央国企 等）
        + 明显误标「民企」的央国企逐条改判 + 值填错列清理
- P2-3  bianzhi_jobs.province 市级值→省级（unified_city_province 映射 + 雄安新区特例）
- P2-4  bianzhi_jobs 校招性质公告打标 campus_flag（与校招板块口径重叠，不删除）
- P3-2  campus_jobs 垃圾行软删（invalid_reason='junk'，保留 content_hash 防重新入库）

用法：
    python scripts/fix_board_integrity_r279.py           # 干跑，只打印计数
    python scripts/fix_board_integrity_r279.py --apply   # 实际执行并写审计
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402

import cache  # noqa: E402
from database import engine  # noqa: E402

RUN_TAG = "r279_board_integrity"

# P2-2 company_type 归一映射（audit-2 报告草案口径）
CTYPE_NORM = {
    "央国企": ("国有企业", "国企", "中央企业"),
    "民企": ("民营/私企", "民营企业"),
    "外企": ("外企/合资", "外企独资", "外商独资", "港澳台投资", "中外合资", "合资"),
}

# P2-2 标「民企」但实为央国企/国字头单位（audit-2 逐条复核，id: 期望公司名前缀）
MISLABELED_SOE = {
    18816: "中国华建投资控股",
    19159: "中国重汽集团杭州发动机",
    19523: "中国雄安集团",
    21883: "中铁市政环境建设",
    22367: "中国电子产业工程",
    24312: "中国电子云",
    25281: "中国船舶集团有限公司综合技术经济研究院",
    25400: "中铁上海工程局",
    26639: "中国联通软件研究院",
    31880: "中国邮政储蓄银行",
}
# 中科院光电所为科研事业单位，非企业
MISLABELED_SHIYE = {35585: "中国科学院光电技术研究所"}

# P3-2 垃圾行（表格使用说明），软删；33092 company_type 值填错列（'莱克集团'）
JUNK_IDS = (18518, 18565)
BAD_CTYPE_ID = 33092

# P2-3 特例：非市级但可归省的取值
PROVINCE_SPECIAL = {"雄安新区": "河北"}

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


def _audit_and_update(conn, apply, *, table, field, new_value, where_sql, params,
                      reason):
    """记审计后 UPDATE；返回受影响行数。where_sql 内引用行别名 t。"""
    rows = conn.execute(text(
        f"SELECT t.id, t.{field} FROM {table} t WHERE {where_sql}"
    ), params).fetchall()
    if not rows:
        return 0
    if apply:
        conn.execute(text(
            "INSERT INTO data_fix_audit (run_tag, table_name, row_id, field,"
            " old_value, new_value, reason)"
            " VALUES (:tag, :tb, :rid, :f, :old, :new, :r)"
        ), [{"tag": RUN_TAG, "tb": table, "rid": r[0], "f": field,
             "old": None if r[1] is None else str(r[1]),
             "new": None if new_value is None else str(new_value),
             "r": reason} for r in rows])
        conn.execute(text(
            f"UPDATE {table} t SET {field} = :new_value WHERE {where_sql}"
        ), {**params, "new_value": new_value})
    return len(rows)


def fix_p12_positions(conn, apply):
    where = ("t.dup_of_id IS NULL AND t.invalid_reason IS NULL"
             " AND t.job_type = '事业单位/事业编'"
             " AND (t.employer LIKE '%国能%' OR t.employer LIKE '%国家能源集团%'"
             "      OR t.employer LIKE '%国电电力%')")
    n = _audit_and_update(conn, apply, table="positions", field="job_type",
                          new_value="央企/国企", where_sql=where, params={},
                          reason="P1-2 国家能源集团系央企社招误标事业编")
    print(f"P1-2 positions 国能系改判 央企/国企: {n} 行")


def fix_p22_campus(conn, apply):
    for target, sources in CTYPE_NORM.items():
        src_list = ", ".join(f"'{s}'" for s in sources)
        n = _audit_and_update(
            conn, apply, table="campus_jobs", field="company_type",
            new_value=target, where_sql=f"t.company_type IN ({src_list})",
            params={}, reason=f"P2-2 company_type 归一 → {target}")
        print(f"P2-2 campus company_type → {target}: {n} 行")
    for rid, prefix in MISLABELED_SOE.items():
        n = _audit_and_update(
            conn, apply, table="campus_jobs", field="company_type",
            new_value="央国企",
            where_sql="t.id = :rid AND t.company_type = '民企'"
                      " AND t.company LIKE :pfx",
            params={"rid": rid, "pfx": f"{prefix}%"},
            reason="P2-2 民企误标复核改判央国企")
        if n == 0:
            print(f"P2-2 误标改判跳过（id={rid} 不匹配预期公司/类型）")
    print(f"P2-2 民企误标改判央国企: 目标 {len(MISLABELED_SOE)} 行")
    for rid, prefix in MISLABELED_SHIYE.items():
        _audit_and_update(
            conn, apply, table="campus_jobs", field="company_type",
            new_value="机关/事业单位/非营利机构",
            where_sql="t.id = :rid AND t.company_type = '民企'"
                      " AND t.company LIKE :pfx",
            params={"rid": rid, "pfx": f"{prefix}%"},
            reason="P2-2 民企误标复核改判事业单位")
    n = _audit_and_update(
        conn, apply, table="campus_jobs", field="company_type", new_value=None,
        where_sql="t.id = :rid AND t.company_type = '莱克集团'",
        params={"rid": BAD_CTYPE_ID}, reason="P2-2 company_type 值填错列清 NULL")
    print(f"P2-2 值填错列清 NULL: {n} 行")


def fix_p32_campus_junk(conn, apply):
    ids = ", ".join(str(i) for i in JUNK_IDS)
    n = _audit_and_update(
        conn, apply, table="campus_jobs", field="invalid_reason",
        new_value="junk",
        where_sql=f"t.id IN ({ids}) AND t.invalid_reason IS NULL",
        params={}, reason="P3-2 表格使用说明垃圾行软删")
    print(f"P3-2 campus 垃圾行软删: {n} 行")


def fix_p23_bianzhi_province(conn, apply):
    rows = conn.execute(text(
        """SELECT b.id, b.province, u.province AS new_prov
           FROM bianzhi_jobs b
           JOIN unified_city_province u
             ON regexp_replace(b.province, '市$', '') = u.city
           WHERE b.province IS NOT NULL AND b.province <> ''
             AND b.province NOT IN (SELECT DISTINCT province FROM unified_city_province)"""
    )).fetchall()
    special = conn.execute(text(
        "SELECT id, province FROM bianzhi_jobs WHERE province = ANY(:vals)"
    ), {"vals": list(PROVINCE_SPECIAL)}).fetchall()
    if apply and (rows or special):
        conn.execute(text(
            "INSERT INTO data_fix_audit (run_tag, table_name, row_id, field,"
            " old_value, new_value, reason)"
            " VALUES (:tag, 'bianzhi_jobs', :rid, 'province', :old, :new,"
            " 'P2-3 市级 province 归一省级')"
        ), [{"tag": RUN_TAG, "rid": r[0], "old": r[1], "new": r[2]} for r in rows]
           + [{"tag": RUN_TAG, "rid": r[0], "old": r[1],
               "new": PROVINCE_SPECIAL[r[1]]} for r in special])
        conn.execute(text(
            """UPDATE bianzhi_jobs b SET province = u.province
               FROM unified_city_province u
               WHERE regexp_replace(b.province, '市$', '') = u.city
                 AND b.province IS NOT NULL AND b.province <> ''
                 AND b.province NOT IN (SELECT DISTINCT province FROM unified_city_province)"""
        ))
        for src, dst in PROVINCE_SPECIAL.items():
            conn.execute(text(
                "UPDATE bianzhi_jobs SET province = :dst WHERE province = :src"
            ), {"src": src, "dst": dst})
    print(f"P2-3 bianzhi province 市级归省级: {len(rows)} 行 + 特例 {len(special)} 行")


def fix_p24_bianzhi_campus_flag(conn, apply):
    conn.execute(text(
        "ALTER TABLE bianzhi_jobs ADD COLUMN IF NOT EXISTS"
        " campus_flag boolean NOT NULL DEFAULT false"
    ))
    n = _audit_and_update(
        conn, apply, table="bianzhi_jobs", field="campus_flag", new_value=True,
        where_sql="t.employer LIKE '%校园招聘%' AND NOT t.campus_flag",
        params={}, reason="P2-4 校招性质公告打标（与校招板块口径重叠）")
    print(f"P2-4 bianzhi 校招公告打标 campus_flag: {n} 行")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="实际执行（默认干跑）")
    args = parser.parse_args()

    with engine.connect() as conn:
        conn.execute(text("SET statement_timeout = 0"))
        conn.execute(text(AUDIT_DDL))
        conn.execute(text(
            "ALTER TABLE campus_jobs ADD COLUMN IF NOT EXISTS invalid_reason varchar(50)"
        ))
        conn.commit()
        fix_p12_positions(conn, args.apply)
        fix_p22_campus(conn, args.apply)
        fix_p32_campus_junk(conn, args.apply)
        fix_p23_bianzhi_province(conn, args.apply)
        fix_p24_bianzhi_campus_flag(conn, args.apply)
        if args.apply:
            conn.commit()
            n = cache.invalidate_prefixes(
                "jobs", "jobs_filters", "positions", "filters", "stats",
                "campus_counts", "campus_filters", "campus_timeline",
                "seo_index", "seo_prov", "seo_prov_et", "seo_city", "seo_city_et",
                "seo_major_counts", "seo_major_index", "seo_major",
                "seo_topic_counts", "seo_topic_index", "seo_topic",
                "seo_rank_stats", "seo_sbx_stats", "seo_rank_index",
                "seo_rank_shangan", "seo_rank_sanbuxian", "seo_feed")
            print(f"缓存失效: {n} 键")
            print("完成。请随后执行 refresh_unified_jobs（物化视图重建/刷新）+ warm_seo_pages。")
        else:
            conn.rollback()
            print("干跑结束（未写库）。加 --apply 实际执行。")


if __name__ == "__main__":
    main()
