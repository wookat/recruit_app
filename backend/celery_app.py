import os
from celery import Celery
from celery.schedules import crontab

BROKER = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")

celery_app = Celery(
    "recruit_tasks",
    broker=BROKER,
    backend=BACKEND,
    include=["tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600,
    worker_prefetch_multiplier=1,
    result_expires=3600 * 24,
    beat_schedule={
        "check-watch-sources": {
            "task": "tasks.check_watch_sources",
            "schedule": crontab(hour=6, minute=0),  # 每天 6:00 检查全部来源
        },
        "refresh-hot-cache": {
            "task": "tasks.refresh_hot_cache",
            "schedule": crontab(hour=6, minute=30),  # 采集入库后刷新 stats/filters 热缓存
        },
        "data-quality-audit": {
            "task": "tasks.data_quality_audit",
            "schedule": crontab(hour=7, minute=0),  # 采集入库后做数据质量审计+deadline 回填
        },
        "cleanup-exports": {
            "task": "tasks.cleanup_exports",
            "schedule": crontab(hour=5, minute=30),  # 清理超过 24h 的导出文件
        },
    },
)
