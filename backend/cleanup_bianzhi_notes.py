"""一次性清理 bianzhi_jobs 中的说明文案行（非岗位）。

判定规则同 refresh_feishu.is_bianzhi_note_row（保守：单位名含引导提示词
且无截止/考试日期且公告链接缺失或无效）。默认 dry-run 只打印待删行，
--apply 才执行删除。

用法：
    python cleanup_bianzhi_notes.py            # dry-run
    python cleanup_bianzhi_notes.py --apply    # 实际删除
"""
import argparse

from database import SessionLocal
from models import BianzhiJob
from refresh_feishu import is_bianzhi_note_row


def find_note_rows(db):
    rows = []
    for job in db.query(BianzhiJob).yield_per(1000):
        d = {
            "employer": job.employer,
            "deadline_text": job.deadline_text,
            "exam_time": job.exam_time,
            "announce_url": job.announce_url,
        }
        if is_bianzhi_note_row(d):
            rows.append(job)
    return rows


def main():
    parser = argparse.ArgumentParser(description="清理 bianzhi_jobs 说明文案行")
    parser.add_argument("--apply", action="store_true", help="实际删除（默认只打印）")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        rows = find_note_rows(db)
        print(f"匹配到 {len(rows)} 行说明文案：")
        for job in rows:
            print(f"  id={job.id} category={job.category!r} province={job.province!r} "
                  f"employer={job.employer!r} announce_url={job.announce_url!r} "
                  f"apply_url={job.apply_url!r}")
        if not args.apply:
            print("dry-run：未删除任何行（--apply 执行删除）")
            return
        for job in rows:
            db.delete(job)
        db.commit()
        print(f"已删除 {len(rows)} 行")
    finally:
        db.close()


if __name__ == "__main__":
    main()
