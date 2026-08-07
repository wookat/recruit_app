"""板块口径常量：positions 表内哪些 job_type 属于「体制内」板块。

- 严格口径（TIZHINEI_STRICT_JOB_TYPES）：仅编制类岗位，
  供 /topic「体制内」专题、三不限榜单等内容页统计使用（seo.py）。
- 板块口径（TIZHINEI_BOARD_JOB_TYPES）：严格口径 + 央企/国企、银行，
  供 unified_jobs 物化视图「体制内」分支使用；
  「其他企业」（纯企业招聘）不属于体制内板块。
"""

TIZHINEI_STRICT_JOB_TYPES = ("公务员", "事业单位/事业编", "军队文职",
                             "选调生", "教师", "三支一扶")

TIZHINEI_BOARD_JOB_TYPES = TIZHINEI_STRICT_JOB_TYPES + ("央企/国企", "银行")
