"""R214: 体制内岗位关键字段补全（小批量试点）。

从 positions.source_url 指向的公告页二次解析，补全 signup_time / exam_time /
signup_deadline 等缺失字段。

安全与规范：
- 只抓公开公告页；同一域名限速（默认 1s/请求）；UA 标注来源；超时重试一次。
- 绝不覆盖已有非空字段（SQL 层 WHERE 双重保护）。
- 解析置信度低（同页多个候选日期无法判别）时跳过并记录。
- 逐条 JSONL 审计日志（id、url、解析字段、置信度、来源 URL、抓取时间）。
- 断点续跑：state 文件记录已处理 id。
- --dry-run 只输出解析结果，不写库。

用法示例（在生产 recruit-app 容器内执行，DATABASE_URL 已由容器提供）：
    python enrich_positions.py --domains www.jingjia.org,zhejiang.jingjia.org,zw.zgsydw.com \
        --limit 500 --dry-run --audit-log /tmp/enrich_audit.jsonl --state-file /tmp/enrich_state.txt
实际写库：同上去掉 --dry-run 加 --apply。
"""

import argparse
import datetime
import json
import os
import re
import sys
import time
from html import unescape
from urllib.parse import urlparse

import psycopg2
import requests

USER_AGENT = (
    "RecruitEnrichBot/0.1 (+https://jobs.zalize.com; field-enrichment pilot; "
    "contact: admin@zalize.com)"
)
REQUEST_TIMEOUT = 20
SUPPORTED_DOMAINS = {"www.jingjia.org", "zhejiang.jingjia.org", "zw.zgsydw.com"}

CN_DATE = r"\d{4}年\d{1,2}月\d{1,2}日"


def strip_html(html: str) -> str:
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", html)
    text = unescape(text)
    return re.sub(r"\s+", " ", text)


def cn_date_to_date(s):
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", s)
    if not m:
        return None
    try:
        return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


SIGNUP_EXCLUDE = re.compile(
    r"准考证|打印|领取|查询|成绩|资格审查|资格初审|改报|咨询|缴费|二轮|上传|扫描件|发布"
)
DATE_START = r"\d{4}年\d{1,2}月\d{1,2}日(?:\d{1,2}[:：]\d{2})?"
DATE_END = r"(?:\d{4}年)?(?:\d{1,2}月)?\d{1,2}日(?:\d{1,2}[:：]\d{2})?"
RANGE_PAT = re.compile(
    r"(" + DATE_START + r")\s*(?:至|—|－|~)\s*(" + DATE_END + r")"
)


def _normalize_end(start: str, end: str) -> str:
    """补全区间结束日期缺省的年/月（从开始日期继承）。"""
    if "年" not in end:
        year = start[: start.index("年") + 1]
        if "月" not in end:
            month = start[start.index("年") + 1: start.index("月") + 1]
            end = month + end
        end = year + end
    return end


def parse_jingjia(text: str):
    """京佳教育公告页（选调生公告全文转载）。

    报名窗口：含『报名/填写』且不含排除词的句子里的日期区间，如
    『于2024年10月9日至10月15日登录…报名』『报名时间为2025年12月4日9:00至8日16:00』。
    笔试时间：『笔试时间(暂定)为YYYY年M月D日』。
    返回 (fields, confidence, reason)。同类字段出现多个互相矛盾的候选时降置信度并跳过。
    """
    fields = {}
    notes = []

    signup_matches = []
    for m in RANGE_PAT.finditer(text):
        # 匹配点前后局部上下文（截断到句号），须含“报名”，且不含排除词
        before = text[max(0, m.start() - 60): m.start()].rsplit("。", 1)[-1]
        after = text[m.end(): m.end() + 90].split("。", 1)[0]
        ctx = before + after
        if "报名" not in ctx:
            continue
        if SIGNUP_EXCLUDE.search(ctx):
            continue
        start = m.group(1)
        end = _normalize_end(start, m.group(2))
        val = (start, end)
        if val not in signup_matches:
            signup_matches.append(val)
    if len(signup_matches) == 1:
        start, end = signup_matches[0]
        fields["signup_time"] = f"{start}至{end}"
        fields["signup_deadline"] = cn_date_to_date(end)
    elif len(signup_matches) > 1:
        notes.append(f"multiple signup windows: {signup_matches}")

    exam_pat = re.compile(r"笔试时间(?:暂定)?为?[：:]?\s*(" + CN_DATE + r")")
    exam_matches = []
    for m in exam_pat.finditer(text):
        if m.group(1) not in exam_matches:
            exam_matches.append(m.group(1))
    if len(exam_matches) == 1:
        fields["exam_time"] = exam_matches[0]
    elif len(exam_matches) > 1:
        notes.append(f"multiple exam dates: {exam_matches}")

    if not fields:
        return {}, "none", "; ".join(notes) or "no pattern matched"
    confidence = "high" if not notes else "low"
    return fields, confidence, "; ".join(notes)


def parse_zgsydw(text: str):
    """中公事业单位职位页：结构化字段『报名时间 <值> 缴费时间』『笔试时间 <值> 考试内容』。

    大量页面值为空或 0000-00-00（站点本身缺数据），仅在值有效时输出。
    """
    fields = {}
    notes = []

    m = re.search(r"报名时间\s+(\S.*?)\s*缴费时间", text)
    if m:
        val = m.group(1).strip()
        # 去掉无信息量的 00:00:00 时间部分
        val = re.sub(r"\s+00:00:00", "", val)
        if val and "0000-00-00" not in val and re.search(r"\d{4}", val):
            fields["signup_time"] = val
            dates = re.findall(r"\d{4}-\d{2}-\d{2}", val)
            if dates:
                try:
                    fields["signup_deadline"] = datetime.date.fromisoformat(dates[-1])
                except ValueError:
                    pass

    m = re.search(r"笔试时间\s+(\d{4}-\d{2}-\d{2})(?:\s+\d{2}:\d{2}:\d{2})?", text)
    if m and not m.group(1).startswith("0000"):
        fields["exam_time"] = m.group(1)

    if not fields:
        return {}, "none", "page has empty/placeholder date fields"
    return fields, "high", "; ".join(notes)


PARSERS = {
    "www.jingjia.org": parse_jingjia,
    "zhejiang.jingjia.org": parse_jingjia,
    "zw.zgsydw.com": parse_zgsydw,
}


class Fetcher:
    """带 UA、按域名限速、超时重试一次、同 URL 缓存的抓取器。"""

    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self.last_request_at = {}
        self.cache = {}
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT

    def fetch(self, url: str):
        if url in self.cache:
            return self.cache[url]
        domain = urlparse(url).netloc
        for attempt in (1, 2):
            wait = self.min_interval - (time.time() - self.last_request_at.get(domain, 0))
            if wait > 0:
                time.sleep(wait)
            self.last_request_at[domain] = time.time()
            try:
                resp = self.session.get(url, timeout=REQUEST_TIMEOUT)
                if resp.status_code == 200:
                    resp.encoding = resp.apparent_encoding or resp.encoding
                    result = (resp.text, None)
                    break
                result = (None, f"http {resp.status_code}")
            except requests.RequestException as exc:
                result = (None, f"{type(exc).__name__}: {exc}")
        self.cache[url] = result
        return result


def load_state(path):
    if not path or not os.path.exists(path):
        return set()
    with open(path) as f:
        return {int(line) for line in f if line.strip()}


def is_blank(v):
    return v is None or str(v).strip() == ""


def main():
    ap = argparse.ArgumentParser(description="Enrich positions from announcement pages")
    ap.add_argument("--domains", required=True, help="comma-separated source domains")
    ap.add_argument("--limit", type=int, default=500, help="batch size (rows)")
    ap.add_argument("--dry-run", action="store_true", help="parse only, no DB writes")
    ap.add_argument("--apply", action="store_true", help="write parsed fields to DB")
    ap.add_argument("--rate", type=float, default=1.0, help="min seconds between requests per domain")
    ap.add_argument("--state-file", default="enrich_state.txt")
    ap.add_argument("--audit-log", default="enrich_audit.jsonl")
    ap.add_argument("--db-url", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()

    if args.dry_run == args.apply:
        ap.error("specify exactly one of --dry-run / --apply")
    if not args.db_url:
        ap.error("--db-url or DATABASE_URL required")
    if args.rate < 1.0:
        ap.error("--rate must be >= 1.0 (per-domain politeness)")
    domains = [d.strip() for d in args.domains.split(",") if d.strip()]
    unsupported = [d for d in domains if d not in PARSERS]
    if unsupported:
        ap.error(f"no parser for domains: {unsupported} (supported: {sorted(PARSERS)})")

    processed = load_state(args.state_file)
    conn = psycopg2.connect(args.db_url)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute(
        """
        SELECT id, source_url, signup_time, exam_time, signup_deadline
        FROM positions
        WHERE dup_of_id IS NULL AND invalid_reason IS NULL
          AND substring(source_url from 'https?://([^/]+)') = ANY(%s)
          AND ((signup_time IS NULL OR signup_time = '')
               OR (exam_time IS NULL OR exam_time = ''))
        ORDER BY md5(id::text)  -- 确定性伪随机，批次覆盖更多公告页且可断点续跑
        """,
        (domains,),
    )
    rows = [r for r in cur.fetchall() if r[0] not in processed][: args.limit]
    print(f"[enrich] candidates after state filter: {len(rows)} (limit {args.limit})", flush=True)

    fetcher = Fetcher(args.rate)
    stats = {"parsed": 0, "updated": 0, "skipped_low_conf": 0, "no_fields": 0, "fetch_error": 0}
    fetched_at_cache = {}

    with open(args.audit_log, "a") as audit, open(args.state_file, "a") as state:
        for pid, url, cur_signup, cur_exam, cur_deadline in rows:
            domain = urlparse(url).netloc
            entry = {
                "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "id": pid,
                "url": url,
                "domain": domain,
            }
            if url not in fetched_at_cache:
                fetched_at_cache[url] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            entry["fetched_at"] = fetched_at_cache[url]

            html, err = fetcher.fetch(url)
            if err:
                entry.update(action="fetch_error", error=err, confidence="none")
                stats["fetch_error"] += 1
            else:
                fields, confidence, reason = PARSERS[domain](strip_html(html))
                entry["parsed"] = {
                    k: (v.isoformat() if isinstance(v, datetime.date) else v)
                    for k, v in fields.items()
                }
                entry["confidence"] = confidence
                if reason:
                    entry["reason"] = reason
                if not fields:
                    entry["action"] = "no_fields"
                    stats["no_fields"] += 1
                elif confidence != "high":
                    entry["action"] = "skipped_low_confidence"
                    stats["skipped_low_conf"] += 1
                else:
                    stats["parsed"] += 1
                    to_set = {}
                    if "signup_time" in fields and is_blank(cur_signup):
                        to_set["signup_time"] = fields["signup_time"]
                    if "exam_time" in fields and is_blank(cur_exam):
                        to_set["exam_time"] = fields["exam_time"]
                    if fields.get("signup_deadline") and cur_deadline is None:
                        to_set["signup_deadline"] = fields["signup_deadline"]
                    entry["would_set"] = {
                        k: (v.isoformat() if isinstance(v, datetime.date) else v)
                        for k, v in to_set.items()
                    }
                    if args.apply and to_set:
                        # SQL 层再次保证绝不覆盖非空值
                        sets, params = [], []
                        for col, val in to_set.items():
                            if col == "signup_deadline":
                                sets.append("signup_deadline = COALESCE(signup_deadline, %s)")
                            else:
                                sets.append(
                                    f"{col} = CASE WHEN {col} IS NULL OR {col} = '' "
                                    f"THEN %s ELSE {col} END"
                                )
                            params.append(val)
                        params.append(pid)
                        cur.execute(
                            f"UPDATE positions SET {', '.join(sets)} WHERE id = %s", params
                        )
                        conn.commit()
                        entry["action"] = "updated"
                        stats["updated"] += 1
                    else:
                        entry["action"] = "dry_run"

            audit.write(json.dumps(entry, ensure_ascii=False) + "\n")
            audit.flush()
            state.write(f"{pid}\n")
            state.flush()

    conn.close()
    print(f"[enrich] done. stats: {json.dumps(stats)}", flush=True)


if __name__ == "__main__":
    main()
