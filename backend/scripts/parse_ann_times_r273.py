"""R273 路线②试点：对缺报名/考试时间且 notes 带官方公告链接的 zgsydw 行，
二次抓取公告页并正则提取「报名时间/笔试时间」，按公告批次回填。

- 限速 >=1s/请求，UA 标明用途；每个公告链接只抓一次（缺失行高度集中，
  ~13 万行仅对应几十个公告链接）。
- 提取结果先 dry-run 打印供人工核对；--execute 时仅回填空字段并写审计 JSONL。
- 提取不到或模式不明的链接一律跳过（宁可不填）。

用法（recruit-app 容器内）：
  python scripts/parse_ann_times_r273.py --max-links 30 --max-rows 500
  python scripts/parse_ann_times_r273.py --max-links 30 --max-rows 500 --execute
"""

import argparse
import json
import os
import re
import time

import psycopg2
import requests

UA = "Mozilla/5.0 (compatible; jobs.zalize.com data-quality; contact: admin@zalize.com)"
AUDIT_DIR = "/tmp/r273_audit"

DATE_PART = r"[0-9０-９]{1,4}\s*年?\s*[0-9０-９]{1,2}\s*月\s*[0-9０-９]{1,2}\s*日?[0-9:：时分\s]*"
SIGNUP_RES = [
    re.compile(r"报名时间[为：:是]?\s*(" + DATE_PART + r"[至—\-~]" + DATE_PART + r")"),
    re.compile(r"报名[^。；\n]{0,10}?(?:时间)?[为：:]?\s*(" + DATE_PART + r"[至—\-~]" + DATE_PART + r")[^。]{0,20}?(?:期间)?(?:进行)?报?名?"),
]
EXAM_RES = [
    re.compile(r"笔试时间[暂定为：:是]{0,3}\s*((?:[0-9０-９]{2,4}年)?[0-9０-９]{1,2}月[0-9０-９]{1,2}日|[0-9０-９]{1,2}月[中下上]{1,2}旬)"),
    re.compile(r"笔试[^。；\n]{0,15}?时间[暂定为：:]{0,3}\s*((?:[0-9０-９]{2,4}年)?[0-9０-９]{1,2}月[0-9０-９]{1,2}日|[0-9０-９]{1,2}月[中下上]{1,2}旬)"),
]


def extract(text):
    signup = exam = None
    for rx in SIGNUP_RES:
        m = rx.search(text)
        if m:
            signup = re.sub(r"\s+", "", m.group(1))
            break
    for rx in EXAM_RES:
        m = rx.search(text)
        if m:
            exam = re.sub(r"\s+", "", m.group(1))
            break
    return signup, exam


def fetch(url):
    r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
    r.raise_for_status()
    if r.encoding and r.encoding.lower() in ("iso-8859-1", "ascii"):
        r.encoding = r.apparent_encoding
    return re.sub(r"<[^>]+>", "", r.text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-links", type=int, default=30)
    ap.add_argument("--max-rows", type=int, default=500)
    ap.add_argument("--execute", action="store_true")
    args = ap.parse_args()

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute(
        """
        WITH z AS (
          SELECT id, substring(notes FROM '公告链接：(https?://[^；\\s]+)') AS ann
          FROM positions
          WHERE dup_of_id IS NULL AND invalid_reason IS NULL
            AND source_url LIKE '%%zgsydw%%'
            AND COALESCE(signup_time,'') = '' AND COALESCE(exam_time,'') = ''
        )
        SELECT ann, count(*) FROM z WHERE ann IS NOT NULL
        GROUP BY ann ORDER BY count(*) DESC LIMIT %s
        """,
        (args.max_links,),
    )
    links = cur.fetchall()

    os.makedirs(AUDIT_DIR, exist_ok=True)
    ts = time.strftime("%Y%m%dT%H%M%S")
    mode = "exec" if args.execute else "dryrun"
    audit_path = os.path.join(AUDIT_DIR, f"parse_ann_times_r273_{mode}_{ts}.jsonl")

    filled = 0
    with open(audit_path, "w", encoding="utf-8") as f:
        for ann, cnt in links:
            if filled >= args.max_rows:
                break
            try:
                text = fetch(ann)
            except Exception as e:
                print(f"SKIP fetch-fail {ann}: {e}")
                time.sleep(1.2)
                continue
            time.sleep(1.2)
            signup, exam = extract(text)
            print(f"{ann} rows={cnt} signup={signup!r} exam={exam!r}")
            if not signup and not exam:
                continue
            budget = args.max_rows - filled
            for field, val in (("signup_time", signup), ("exam_time", exam)):
                if not val:
                    continue
                cur.execute(
                    f"""
                    SELECT id FROM positions
                    WHERE dup_of_id IS NULL AND invalid_reason IS NULL
                      AND source_url LIKE '%%zgsydw%%'
                      AND substring(notes FROM '公告链接：(https?://[^；\\s]+)') = %s
                      AND COALESCE({field},'') = ''
                    ORDER BY id LIMIT %s
                    """,
                    (ann, budget),
                )
                ids = [r[0] for r in cur.fetchall()]
                for pid in ids:
                    f.write(json.dumps({
                        "id": pid, "field": field, "old": "", "new": val,
                        "rule": "ann_link_parse", "batch_key": ann,
                        "ts": ts, "executed": bool(args.execute),
                    }, ensure_ascii=False) + "\n")
                    if args.execute:
                        cur.execute(
                            f"UPDATE positions SET {field} = %s "
                            f"WHERE id = %s AND ({field} IS NULL OR {field} = '')",
                            (val, pid),
                        )
                filled = max(filled, 0) + 0  # row budget counted below
            # count rows (not fields) against budget: rows are the union of ids above
            filled += min(cnt, budget)
    if args.execute:
        conn.commit()
    print(f"mode={mode} audit={audit_path}")


if __name__ == "__main__":
    main()
