"""统一岗位聚合层：unified_jobs 物化视图（体制内 + 校招 + 编制）。

- 辅助表 unified_city_province：城市→省份映射（normalizer 行政区划数据落库，
  供视图内解析校招 locations / 编制 work_location 的首个城市并映射省份）。
- 物化视图 unified_jobs：三表 UNION ALL 到统一 schema，
  排除 positions 中 dup_of_id / invalid_reason 非空的行。
- 每日采集后由 Celery 任务 REFRESH MATERIALIZED VIEW CONCURRENTLY 刷新。
"""
from sqlalchemy import text

from board_scope import TIZHINEI_BOARD_JOB_TYPES
from database import engine
from normalizer import CITY_TO_PROVINCE

MUNICIPALITIES = ("北京", "天津", "上海", "重庆")

#: 五档学历归一（与 normalizer.normalize_edu 口径一致的 SQL 版本）
EDU_NORM_SQL = """
CASE
  WHEN lower(coalesce({col}, '')) ~ '(博士|phd|ph\\.d)' THEN '博士研究生'
  WHEN lower(coalesce({col}, '')) LIKE '%硕士%'
       OR (lower(coalesce({col}, '')) LIKE '%研究生%'
           AND lower(coalesce({col}, '')) NOT LIKE '%博士%') THEN '硕士研究生'
  WHEN lower(coalesce({col}, '')) LIKE '%本科%'
       OR (lower(coalesce({col}, '')) LIKE '%大学%'
           AND lower(coalesce({col}, '')) NOT LIKE '%专科%') THEN '本科'
  WHEN lower(coalesce({col}, '')) ~ '(大专|中专|中技|高职|专科)' THEN '大专/中专'
  ELSE '其他/不限'
END
"""

#: 多值地点原文拆词（支持「北京、上海」「山东-青岛」等格式）
LOC_ARR_SQL = (
    "regexp_split_to_array(coalesce({col}, ''), '[-|、,，/;；[:space:]]+')"
)

#: 去掉尾缀「市/省/自治区」后的单个地名词
CLEAN_LOC_SQL = "nullif(regexp_replace(coalesce({tok}, ''), '(市|省|自治区)$', ''), '')"

#: 体制内板块 job_type 白名单（排除 positions 内纯企业招聘行：其他企业）
TIZHINEI_JOB_TYPE_SQL = ", ".join(f"'{t}'" for t in TIZHINEI_BOARD_JOB_TYPES)

CREATE_VIEW = f"""
CREATE MATERIALIZED VIEW unified_jobs AS
SELECT
  '体制内'::text AS source_board,
  p.id AS source_id,
  p.position_example AS title,
  p.employer AS employer,
  p.exam_type_norm AS category,
  coalesce(nullif(p.edu_level_norm, ''), '其他/不限') AS edu_level_norm,
  coalesce(nullif(p.undergrad_major, ''), nullif(p.grad_major, ''), p.raw_major) AS major,
  p.province AS province,
  p.city AS city,
  p.district AS district,
  p.work_location AS work_location,
  p.signup_deadline::date AS deadline_date,
  p.source_url AS announce_url,
  NULL::text AS apply_url,
  NULL::text AS industry,
  NULL::text AS grad_years,
  p.search_text AS search_text,
  p.created_at AS created_at
FROM positions p
WHERE p.dup_of_id IS NULL AND p.invalid_reason IS NULL
  AND NOT p.cross_board_dup
  AND p.job_type IN ({TIZHINEI_JOB_TYPE_SQL})
UNION ALL
SELECT
  '校招'::text,
  c.id,
  c.positions,
  c.company,
  c.company_type,
  {EDU_NORM_SQL.format(col='c.edu_requirement')},
  c.major_requirement,
  ucp.province,
  ucp.city,
  NULL::text AS district,
  c.locations,
  c.deadline_date,
  c.announce_url,
  c.apply_url,
  c.industry,
  c.grad_years,
  concat_ws(' ', c.company, c.positions, c.industry, c.major_requirement, c.locations),
  c.created_at
FROM campus_jobs c
LEFT JOIN LATERAL (
  SELECT {LOC_ARR_SQL.format(col='c.locations')} AS a
) la ON true
LEFT JOIN LATERAL (
  SELECT
    coalesce(u1.city, u2.city) AS city,
    coalesce(u1.province, u2.province,
             (SELECT min(x.province) FROM unified_city_province x
              WHERE x.province = {CLEAN_LOC_SQL.format(tok='la.a[1]')})) AS province
  FROM (SELECT 1) _
  LEFT JOIN unified_city_province u1 ON u1.city = {CLEAN_LOC_SQL.format(tok='la.a[1]')}
  LEFT JOIN unified_city_province u2 ON u2.city = {CLEAN_LOC_SQL.format(tok='la.a[2]')}
) ucp ON true
WHERE c.invalid_reason IS NULL
UNION ALL
SELECT
  '编制'::text,
  b.id,
  b.job_type,
  b.employer,
  b.category,
  {EDU_NORM_SQL.format(col='b.edu_requirement')},
  b.major_requirement,
  coalesce(nullif(b.province, ''), ucp.province),
  ucp.city,
  NULL::text AS district,
  b.work_location,
  b.deadline_date,
  b.announce_url,
  b.apply_url,
  NULL::text,
  NULL::text,
  concat_ws(' ', b.employer, b.job_type, b.work_location, b.major_requirement),
  b.created_at
FROM bianzhi_jobs b
LEFT JOIN LATERAL (
  SELECT {LOC_ARR_SQL.format(col='b.work_location')} AS a
) lb ON true
LEFT JOIN LATERAL (
  SELECT coalesce(u1.city, u2.city) AS city, coalesce(u1.province, u2.province) AS province
  FROM (SELECT 1) _
  LEFT JOIN unified_city_province u1 ON u1.city = {CLEAN_LOC_SQL.format(tok='lb.a[1]')}
  LEFT JOIN unified_city_province u2 ON u2.city = {CLEAN_LOC_SQL.format(tok='lb.a[2]')}
) ucp ON true
"""

INDEXES = [
    # REFRESH CONCURRENTLY 需要唯一索引
    """CREATE UNIQUE INDEX IF NOT EXISTS idx_uj_board_id
       ON unified_jobs (source_board, source_id)""",
    """CREATE INDEX IF NOT EXISTS idx_uj_created
       ON unified_jobs (created_at DESC, source_board, source_id)""",
    """CREATE INDEX IF NOT EXISTS idx_uj_prov_city
       ON unified_jobs (province, city)""",
    """CREATE INDEX IF NOT EXISTS idx_uj_city
       ON unified_jobs (city)""",
    """CREATE INDEX IF NOT EXISTS idx_uj_city_district
       ON unified_jobs (city, district)""",
    """CREATE INDEX IF NOT EXISTS idx_uj_edu
       ON unified_jobs (edu_level_norm)""",
    """CREATE INDEX IF NOT EXISTS idx_uj_deadline
       ON unified_jobs (deadline_date)""",
    """CREATE INDEX IF NOT EXISTS idx_uj_board
       ON unified_jobs (source_board)""",
    """CREATE INDEX IF NOT EXISTS idx_uj_search
       ON unified_jobs USING gin (search_text gin_trgm_ops)""",
]


def ensure_city_province(conn) -> None:
    conn.execute(text(
        """CREATE TABLE IF NOT EXISTS unified_city_province (
               city varchar(50) PRIMARY KEY,
               province varchar(30) NOT NULL
           )"""
    ))
    rows = {c: p for c, p in CITY_TO_PROVINCE.items()}
    for m in MUNICIPALITIES:
        rows[m] = m
    conn.execute(text("DELETE FROM unified_city_province"))
    conn.execute(
        text("INSERT INTO unified_city_province (city, province) VALUES (:city, :province)"),
        [{"city": c, "province": p} for c, p in rows.items()],
    )
    conn.commit()


def main():
    with engine.connect() as conn:
        # 建视图/索引是长事务，不受全局 20s 语句超时限制
        conn.execute(text("SET statement_timeout = 0"))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        conn.execute(text(
            "ALTER TABLE campus_jobs ADD COLUMN IF NOT EXISTS invalid_reason varchar(50)"
        ))
        conn.execute(text(
            "ALTER TABLE positions ADD COLUMN IF NOT EXISTS"
            " cross_board_dup boolean NOT NULL DEFAULT false"
        ))
        conn.commit()
        ensure_city_province(conn)
        exists = conn.execute(text(
            "SELECT 1 FROM pg_matviews WHERE matviewname = 'unified_jobs'"
        )).scalar()
        if exists:
            has_district = conn.execute(text(
                """SELECT 1 FROM pg_attribute
                   WHERE attrelid = 'unified_jobs'::regclass
                     AND attname = 'district' AND NOT attisdropped"""
            )).scalar()
            if not has_district:
                print("unified_jobs 缺少 district 列，重建 ...")
                conn.execute(text("DROP MATERIALIZED VIEW unified_jobs"))
                conn.commit()
                exists = None
            else:
                definition = conn.execute(text(
                    "SELECT definition FROM pg_matviews WHERE matviewname = 'unified_jobs'"
                )).scalar() or ""
                # R279：体制内分支需含 job_type 白名单，校招分支需排除软删行
                if ("央企/国企" not in definition or "c.invalid_reason" not in definition
                        or "cross_board_dup" not in definition):
                    print("unified_jobs 缺少体制内 job_type 白名单/校招软删过滤/跨板块去重，重建 ...")
                    conn.execute(text("DROP MATERIALIZED VIEW unified_jobs"))
                    conn.commit()
                    exists = None
        if exists:
            print("unified_jobs 已存在，跳过创建（如需重建请先 DROP MATERIALIZED VIEW unified_jobs）")
        else:
            print("CREATE MATERIALIZED VIEW unified_jobs ...")
            conn.execute(text(CREATE_VIEW))
            conn.commit()
        for stmt in INDEXES:
            print(stmt.split("\n")[0].strip())
            conn.execute(text(stmt))
            conn.commit()
        conn.execute(text("ANALYZE unified_jobs"))
        conn.commit()
    print("done")


if __name__ == "__main__":
    main()
