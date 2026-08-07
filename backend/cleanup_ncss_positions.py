"""一次性清理（R277 P0）：positions 表中混入的 NCSS 校招聚合行。

历史上 scrape_ncss_jobs.py 曾把教育部国家大学生就业服务平台（job.ncss.cn）的
校招职位导入 positions（job_type=事业单位/央国企），但 NCSS 的单位性质标注
不可靠（富士康/比亚迪等私企被标为「事业单位」），导致「体制内」板块与
/topic /rank 等内容页口径失真。该数据源已由 collect_ncss.py 正确入库
campus_jobs（校招板块），positions 中的历史行应整体下线。

处理方式：invalid_reason='campus_source'（软删除，与 etl/run_etl.INVALID_SQL
新增规则一致，保证后续 ETL 不会带回）。

用法：
    python cleanup_ncss_positions.py            # dry-run 打印计数与样本
    python cleanup_ncss_positions.py --apply    # 实际标记并失效相关缓存
"""
import argparse

from sqlalchemy import text

import cache
from database import SessionLocal

MARK = "campus_source"
WHERE = "exam_type LIKE '%教育部国家大学生就业服务平台%' AND invalid_reason IS NULL"


def main():
    parser = argparse.ArgumentParser(description="下线 positions 中的 NCSS 校招聚合行")
    parser.add_argument("--apply", action="store_true", help="实际标记（默认只打印）")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        n = db.execute(text(f"SELECT count(*) FROM positions WHERE {WHERE}")).scalar()
        samples = db.execute(text(
            f"SELECT id, employer, job_type, province FROM positions WHERE {WHERE} "
            "ORDER BY id DESC LIMIT 10")).all()
        print(f"匹配到 {n} 行 NCSS 校招聚合行：")
        for r in samples:
            print(f"  id={r[0]} employer={r[1]!r} job_type={r[2]!r} province={r[3]!r}")
        if not args.apply:
            print("dry-run：未修改任何数据（--apply 执行）")
            return
        db.execute(text(
            f"UPDATE positions SET invalid_reason = :m WHERE {WHERE}"), {"m": MARK})
        db.commit()
        cache.invalidate_prefixes(
            "positions", "filters", "stats", "freshness", "recent_updates",
            "pos_comp", "pos_emp_hist", "pos_heat",
            "seo_index", "seo_prov", "seo_prov_et", "seo_city", "seo_city_et",
            "seo_major_counts", "seo_major_index", "seo_major",
            "seo_topic_counts", "seo_topic_index", "seo_topic",
            "seo_rank_stats", "seo_sbx_stats", "seo_rank_index",
            "seo_rank_shangan", "seo_rank_sanbuxian", "seo_feed",
        )
        print(f"已标记 {n} 行 invalid_reason={MARK!r} 并失效相关缓存；"
              "请随后触发 warm_seo_pages 重新预热。")
    finally:
        db.close()


if __name__ == "__main__":
    main()
