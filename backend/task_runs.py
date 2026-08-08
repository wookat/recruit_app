"""Celery 任务执行记录落库（R296 P3-1）。

worker 容器重建即丢 docker 日志，任务成功率无法事后审计；
用 celery 信号把每次任务执行结果写入 task_runs 表（轻量，不含参数/返回值全文）。

查询示例（近 7 天成功率）：
    SELECT task_name, status, count(*) FROM task_runs
    WHERE started_at > now() - interval '7 days'
    GROUP BY 1, 2 ORDER BY 1, 2;
"""
import time
from datetime import datetime, timezone

from celery.signals import task_failure, task_postrun, task_prerun
from sqlalchemy import text

from database import engine

DDL = """
CREATE TABLE IF NOT EXISTS task_runs (
    id bigserial PRIMARY KEY,
    task_name varchar(200) NOT NULL,
    task_id varchar(60) NOT NULL,
    status varchar(20) NOT NULL,
    started_at timestamptz,
    finished_at timestamptz,
    runtime_s double precision,
    error text
);
CREATE INDEX IF NOT EXISTS ix_task_runs_started_at ON task_runs (started_at);
CREATE INDEX IF NOT EXISTS ix_task_runs_task_name ON task_runs (task_name);
"""

_table_ready = False
_start_times: dict = {}


def _ensure_table():
    global _table_ready
    if _table_ready:
        return
    with engine.connect() as conn:
        conn.execute(text(DDL))
        conn.commit()
    _table_ready = True


def _insert(task_name: str, task_id: str, status: str, error: str = ""):
    try:
        _ensure_table()
        started = _start_times.pop(task_id, None)
        now = datetime.now(timezone.utc)
        with engine.connect() as conn:
            conn.execute(text(
                "INSERT INTO task_runs (task_name, task_id, status, started_at,"
                " finished_at, runtime_s, error)"
                " VALUES (:n, :i, :s, :st, :ft, :rt, :e)"),
                {"n": task_name[:200], "i": task_id[:60], "s": status,
                 "st": datetime.fromtimestamp(started, timezone.utc) if started else None,
                 "ft": now,
                 "rt": (time.time() - started) if started else None,
                 "e": (error or "")[:2000] or None})
            conn.commit()
    except Exception:  # noqa: BLE001  记录失败不能影响任务本身
        pass


@task_prerun.connect
def _on_prerun(task_id=None, **kw):
    _start_times[task_id] = time.time()


@task_postrun.connect
def _on_postrun(task_id=None, task=None, state=None, **kw):
    if state == "FAILURE":
        return  # 失败在 task_failure 里带异常信息记录
    _insert(getattr(task, "name", "") or "", task_id or "", (state or "UNKNOWN").lower())


@task_failure.connect
def _on_failure(task_id=None, exception=None, sender=None, **kw):
    _insert(getattr(sender, "name", "") or "", task_id or "", "failure",
            error=repr(exception))
