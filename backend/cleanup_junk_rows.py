"""一次性清理存量脏数据（R92）：

1. bianzhi_jobs 导流/说明行（employer/job_type 含 http(s):// 链接或
   「更多…信息」「直接在…查看」句式）——删除整行；
2. campus_jobs major_requirement 口语占位句（「…哦 宝宝~」）——置空显「—」；
   句尾语气词（哦/呀/啦 等）——仅截断尾部，正文保留。

判定规则与入库层 data_clean.py 完全一致（保证清理后每日同步不再带回）。
默认 dry-run 打印样本与计数，--apply 才执行。

用法：
    python cleanup_junk_rows.py            # dry-run
    python cleanup_junk_rows.py --apply    # 实际删除/清洗
"""
import argparse

from data_clean import clean_major_requirement, is_bianzhi_junk_row
from database import SessionLocal
from models import BianzhiJob, CampusJob

SAMPLE_LIMIT = 20


def find_bianzhi_junk(db):
    rows = []
    for job in db.query(BianzhiJob).yield_per(1000):
        d = {"employer": job.employer, "job_type": job.job_type}
        if is_bianzhi_junk_row(d):
            rows.append(job)
    return rows


def find_campus_dirty_major(db):
    """返回 [(job, cleaned)]，cleaned 为清洗后的值（'' 表示置空）。"""
    out = []
    for job in db.query(CampusJob).filter(CampusJob.major_requirement.isnot(None)).yield_per(1000):
        cleaned = clean_major_requirement(job.major_requirement)
        if cleaned != (job.major_requirement or "").strip():
            out.append((job, cleaned))
    return out


def main():
    parser = argparse.ArgumentParser(description="清理编制导流行 + 校招口语专业要求")
    parser.add_argument("--apply", action="store_true", help="实际删除/清洗（默认只打印）")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        junk = find_bianzhi_junk(db)
        print(f"[bianzhi] 匹配到 {len(junk)} 行导流/说明行：")
        for job in junk[:SAMPLE_LIMIT]:
            print(f"  id={job.id} category={job.category!r} employer={job.employer!r} "
                  f"job_type={job.job_type!r} announce_url={job.announce_url!r}")
        if len(junk) > SAMPLE_LIMIT:
            print(f"  …（其余 {len(junk) - SAMPLE_LIMIT} 行略）")

        dirty = find_campus_dirty_major(db)
        blanked = sum(1 for _, c in dirty if not c)
        print(f"[campus] 匹配到 {len(dirty)} 行口语专业要求（置空 {blanked} / 截断 {len(dirty) - blanked}）：")
        for job, cleaned in dirty[:SAMPLE_LIMIT]:
            print(f"  id={job.id} company={job.company!r} {job.major_requirement!r} -> {cleaned!r}")
        if len(dirty) > SAMPLE_LIMIT:
            print(f"  …（其余 {len(dirty) - SAMPLE_LIMIT} 行略）")

        if not args.apply:
            print("dry-run：未修改任何数据（--apply 执行）")
            return
        for job in junk:
            db.delete(job)
        for job, cleaned in dirty:
            job.major_requirement = cleaned or None
        db.commit()
        print(f"已删除编制导流行 {len(junk)} 行；已清洗校招专业要求 {len(dirty)} 行（置空 {blanked}）")
    finally:
        db.close()


if __name__ == "__main__":
    main()
