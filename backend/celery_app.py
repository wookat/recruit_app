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
        "collect-iguopin-jobs": {
            "task": "tasks.collect_iguopin_jobs",
            "schedule": crontab(hour=5, minute=30),  # 每天采集国聘校招/央国企社招增量
        },
        "collect-ncss-jobs": {
            "task": "tasks.collect_ncss_jobs",
            "schedule": crontab(hour=5, minute=50),  # 每天采集 NCSS 教育部大学生就业平台校招增量
        },
        "collect-ciic-jobs": {
            "task": "tasks.collect_ciic_jobs",
            "schedule": crontab(hour=6, minute=10),  # 每天采集中智招聘校招/央国企社招增量
        },
        "check-watch-sources": {
            "task": "tasks.check_watch_sources",
            "schedule": crontab(hour=6, minute=0),  # 每天 6:00 检查全部来源
        },
        "refresh-feishu-data": {
            "task": "tasks.refresh_feishu_data",
            "schedule": crontab(hour=6, minute=20),  # 每天刷新飞书校招/编制表格增量
        },
        "refresh-hot-cache": {
            "task": "tasks.refresh_hot_cache",
            "schedule": crontab(hour=6, minute=30),  # 采集入库后刷新 stats/filters 热缓存
        },
        "submit-indexnow": {
            "task": "tasks.submit_indexnow",
            "schedule": crontab(hour=7, minute=10),  # 每天采集入库后向 IndexNow 提交 SEO 页 URL
        },
        "enrich-new-details": {
            "task": "tasks.enrich_new_details",
            "schedule": crontab(hour=6, minute=40),  # 采集后补全中智/NCSS 新岗位详情字段（截止/行业）
        },
        "data-quality-audit": {
            "task": "tasks.data_quality_audit",
            "schedule": crontab(hour=7, minute=0),  # 采集入库后做数据质量审计+deadline 回填
        },
        "generate-daily-digest": {
            "task": "tasks.generate_daily_digest",
            "schedule": crontab(hour=7, minute=40),  # 采集入库后生成每日岗位精选文案（渠道内容素材）
        },
        "push-due-reminders": {
            "task": "tasks.push_due_reminders",
            "schedule": crontab(hour=8, minute=30),  # 每天向 Web Push 订阅者发临近截止聚合提醒
        },
        "push-saved-filter-news": {
            "task": "tasks.push_saved_filter_news",
            "schedule": crontab(hour=8, minute=40),  # 每天向订阅者发保存筛选上新聚合推送
        },
        "check-dead-links": {
            "task": "tasks.check_dead_links",
            "schedule": crontab(hour=4, minute=0, day_of_week=1),  # 每周一全量扫描校招/编制链接死链
        },
        "check-dead-links-new": {
            "task": "tasks.check_dead_links_new",
            "schedule": crontab(hour=7, minute=30),  # 每日同步后增量补扫新入库链接
        },
        "cleanup-exports": {
            "task": "tasks.cleanup_exports",
            "schedule": crontab(hour=5, minute=30),  # 清理超过 24h 的导出文件
        },
    },
)
