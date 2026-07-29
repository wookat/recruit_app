import os
import sys

sys.path.insert(0, "/home/ubuntu")
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
from database import Base, SessionLocal
from ingest import ingest_positions_df
from models import Position


def ingest_guokao_2026():
    fp = "/tmp/guokao_2026/中央机关及其直属机构2026年度考试录用公务员招考简章.xls"
    from recruit_parser import parse_position_excel
    df = parse_position_excel(
        fp,
        province="全国",
        source_url="http://bm.scs.gov.cn/kl2026",
        default_exam="2026国家公务员考试",
        job_type="公务员",
    )
    df["year"] = 2026
    df["报名时间"] = "2025-10-15 8:00 至 2025-10-24 18:00"
    df["笔试/考试时间"] = "2025-11-30"
    return df


def ingest_jdwz_2026():
    from recruit_parser import parse_position_excel
    files = [
        ("/tmp/jdwz_2026_a.xlsx", "2026军队文职公开招考（不含先面试后笔试）"),
        ("/tmp/jdwz_2026_b.xlsx", "2026军队文职公开招考（先面试后笔试）"),
    ]
    dfs = []
    for fp, exam in files:
        df = parse_position_excel(
            fp,
            province="全国",
            source_url="http://81rc.81.cn/wzry/gzdt/",
            default_exam=exam,
            job_type="军队文职",
        )
        df["year"] = 2026
        df["报名时间"] = "2025-11-08 8:00 至 2025-11-14 18:00"
        df["笔试/考试时间"] = "2025-12-14"
        dfs.append(df)
    return pd.concat(dfs, ignore_index=True)


if __name__ == "__main__":
    db = SessionLocal()
    try:
        # 国考
        df_gk = ingest_guokao_2026()
        print("国考 2026 rows:", len(df_gk))
        ingest_positions_df(db, df_gk)
        db.commit()

        # 军队文职
        df_jdwz = ingest_jdwz_2026()
        print("军队文职 2026 rows:", len(df_jdwz))
        ingest_positions_df(db, df_jdwz)
        db.commit()

        print("当前总数:", db.query(Position).count())
    finally:
        db.close()
