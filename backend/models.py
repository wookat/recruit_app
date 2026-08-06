from sqlalchemy import Column, Date, Integer, String, Text, DateTime, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY
from database import Base


class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, index=True, nullable=False)
    job_type = Column(String(50), index=True)
    exam_type = Column(String(500), index=True)
    employer = Column(Text)
    position_example = Column(Text)
    edu_requirement = Column(String(500), index=True)
    edu_level_norm = Column(String(30), index=True)
    undergrad_major = Column(Text)
    grad_major = Column(Text)
    exam_form = Column(Text)
    signup_time = Column(Text)
    exam_time = Column(Text)
    special_requirements = Column(Text)
    work_location = Column(String(500), index=True)
    location_tags = Column(ARRAY(String(100)), index=True)
    source_url = Column(Text)
    notes = Column(Text)
    raw_major = Column(Text)
    college_major = Column(Text)
    search_text = Column(Text)
    content_hash = Column(String(32), index=True, unique=True, nullable=True)
    content_hash_v2 = Column(String(32), index=True)
    dup_of_id = Column(Integer)
    invalid_reason = Column(String(50))
    exam_type_norm = Column(String(50), index=True)
    signup_deadline = Column(DateTime, index=True)
    province = Column(String(30), index=True)
    city = Column(String(50), index=True)
    district = Column(String(50), index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_pos_year_job", "year", "job_type"),
        Index("idx_pos_loc_tags", "location_tags", postgresql_using="gin"),
        Index("idx_pos_search_text", "search_text", postgresql_using="gin",
              postgresql_ops={"search_text": "gin_trgm_ops"}),
    )


class CampusJob(Base):
    """校招/社招信息（企业校园招聘汇总，来源：外部汇总表导入）。"""

    __tablename__ = "campus_jobs"

    id = Column(Integer, primary_key=True, index=True)
    source_table = Column(String(50), index=True)  # 校招汇总/24-25届可投/免笔试汇总/内推码/央国企名录
    company = Column(String(300), index=True)
    positions = Column(Text)
    company_type = Column(String(50), index=True)  # 民企/央国企/外企/事业单位...
    industry = Column(String(200), index=True)
    batch = Column(String(100), index=True)  # 秋招/春招/实习...
    grad_years = Column(String(100), index=True)  # 招聘届次：2026届/2027届...
    no_exam = Column(String(50), index=True)  # 是否笔试/免笔试
    edu_requirement = Column(String(200))
    major_requirement = Column(Text)
    locations = Column(String(500), index=True)
    start_date = Column(String(30))
    deadline_text = Column(String(200))
    deadline_date = Column(Date, index=True)
    announce_url = Column(Text)
    apply_url = Column(Text)
    referral_code = Column(String(200))
    notes = Column(Text)
    updated_at_src = Column(String(30))
    content_hash = Column(String(32), unique=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class BianzhiJob(Base):
    """编制类招聘公告（公务员事业单位/教育/医疗/高校/科研院所/央国企社招/大型联考，来源：外部汇总表导入）。"""

    __tablename__ = "bianzhi_jobs"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(50), index=True)  # 公务员事业单位/教育系统/医疗系统/高校高职大专/科研院所/央国企社招/大型联考
    province = Column(String(50), index=True)
    employer = Column(Text)
    headcount = Column(String(200))
    job_type = Column(String(200), index=True)  # 类型/招考类型/企业类型
    work_location = Column(String(500))
    edu_requirement = Column(String(200), index=True)
    major_requirement = Column(Text)
    deadline_text = Column(String(300))
    deadline_date = Column(Date, index=True)
    signup_start = Column(String(50))
    exam_time = Column(String(50))
    notes = Column(Text)
    announce_url = Column(Text)
    apply_url = Column(Text)
    updated_at_src = Column(String(30), index=True)
    content_hash = Column(String(32), unique=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WatchSource(Base):
    """自动化采集的监控来源（公告索引页）。"""

    __tablename__ = "watch_sources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    index_url = Column(Text, nullable=False)
    keywords = Column(String(200))  # 逗号分隔，公告标题需全部包含
    category = Column(String(50))  # 公务员/军队文职/事业单位...
    year = Column(Integer)
    enabled = Column(Integer, default=1, index=True)  # 1=启用 0=停用
    interval_minutes = Column(Integer, default=60)
    last_checked_at = Column(DateTime(timezone=True))
    last_status = Column(String(20))  # ok / error
    last_message = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Feedback(Base):
    """用户「举报数据有误」反馈。"""

    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, index=True)
    board = Column(String(20), nullable=False, index=True)  # positions/campus/bianzhi
    item_id = Column(Integer, nullable=False)
    issue_type = Column(String(20), nullable=False)  # link_broken/wrong_info/expired/other
    note = Column(Text)
    ua = Column(String(300))
    handled = Column(Integer, default=0, index=True)  # 1=已处理 0=待处理
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class LinkCheck(Base):
    """外链存活检测结果（校招投递/公告链接死链扫描，每周任务写入）。"""

    __tablename__ = "link_checks"

    id = Column(Integer, primary_key=True, index=True)
    url = Column(Text, nullable=False, unique=True)
    ok = Column(Integer, nullable=False, index=True)  # 1=可访问 0=失效
    status_code = Column(Integer)  # 最终 HTTP 状态码（连接失败为 NULL）
    error = Column(String(200))
    checked_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PushSubscription(Base):
    """Web Push 订阅：收藏截止日快照随订阅上报，每日定时推送临近截止提醒。"""

    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(String(200), nullable=False)
    auth = Column(String(100), nullable=False)
    remind_days = Column(Integer, nullable=False, default=3)  # 兼容字段：默认节点的最大值
    # 默认提醒节点（截止前天数列表，如 [1,3,7]）；单岗位可在 items 里用 "n" 覆盖
    remind_nodes = Column(Text, nullable=False, default="[3]", server_default="[3]")
    # 已发送节点去重 {"标题|截止日|节点": "发送日期"}，同岗位同节点只发一次
    sent_json = Column(Text, nullable=False, default="{}", server_default="{}")
    items_json = Column(Text, nullable=False, default="[]")  # [{"t": 标题, "d": "YYYY-MM-DD", "n": [节点]?}]
    # 保存筛选快照 [{"n": 名称, "u": 列表 API 路径+参数, "t": 上次推送时的总数基线|null}]
    filters_json = Column(Text, nullable=False, default="[]", server_default="[]")
    failures = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PageViewDaily(Base):
    """自建轻量访问统计：日聚合 PV（无 cookie、无个人数据、IP 不落库）。"""

    __tablename__ = "metrics_pv_daily"
    __table_args__ = (UniqueConstraint("day", "board", "page", name="uq_pv_day_board_page"),)

    id = Column(Integer, primary_key=True, index=True)
    day = Column(Date, nullable=False, index=True)
    board = Column(String(30), nullable=False)
    page = Column(String(50), nullable=False, default="")
    pv = Column(Integer, nullable=False, default=0)


class SessionDaily(Base):
    """独立会话估算：sessionStorage 随机 id（不跨天），每天去重计数。"""

    __tablename__ = "metrics_sessions_daily"
    __table_args__ = (UniqueConstraint("day", "sid", name="uq_sess_day_sid"),)

    id = Column(Integer, primary_key=True, index=True)
    day = Column(Date, nullable=False, index=True)
    sid = Column(String(40), nullable=False)


class DailyDigest(Base):
    """每日岗位精选结构化存档：站内 /daily 栏目页与 SPA 入口的数据源。"""

    __tablename__ = "daily_digests"

    id = Column(Integer, primary_key=True, index=True)
    day = Column(Date, nullable=False, unique=True, index=True)
    intro = Column(Text, nullable=False, default="")
    campus_ids_json = Column(Text, nullable=False, default="[]", server_default="[]")
    bianzhi_ids_json = Column(Text, nullable=False, default="[]", server_default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Announcement(Base):
    """采集到的公告链接，待管理员审核/处理。"""

    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, index=True)
    title = Column(Text, nullable=False)
    url = Column(Text, nullable=False, unique=True)
    status = Column(String(20), default="new", index=True)  # new/processed/ignored/error
    detected_at = Column(DateTime(timezone=True), server_default=func.now())


class CrawlRun(Base):
    """一次采集运行的记录（每个来源一条）。"""

    __tablename__ = "crawl_runs"

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, index=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    finished_at = Column(DateTime(timezone=True))
    status = Column(String(20), default="running", index=True)  # running/success/partial/error
    announcements_found = Column(Integer, default=0)
    attachments_downloaded = Column(Integer, default=0)
    rows_parsed = Column(Integer, default=0)
    rows_ingested = Column(Integer, default=0)
    error = Column(Text)


class Attachment(Base):
    """公告附件下载/解析记录，按 URL + 内容 SHA256 去重。"""

    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, index=True)
    announcement_id = Column(Integer, index=True)
    url = Column(Text, nullable=False, unique=True)
    sha256 = Column(String(64), index=True)
    file_name = Column(String(300))
    size_bytes = Column(Integer)
    status = Column(String(20), default="new", index=True)  # done/duplicate/error
    error = Column(Text)
    parsed_rows = Column(Integer, default=0)
    ingested_rows = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Source(Base):
    __tablename__ = "sources"

    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, index=True)
    job_type = Column(String(50), index=True)
    exam_type = Column(String(500), index=True)
    employer = Column(Text)
    position_example = Column(Text)
    edu_requirement = Column(String(200))
    edu_level_norm = Column(String(30), index=True)
    undergrad_major = Column(Text)
    grad_major = Column(Text)
    exam_form = Column(Text)
    signup_time = Column(Text)
    exam_time = Column(Text)
    special_requirements = Column(Text)
    work_location = Column(String(500), index=True)
    location_tags = Column(ARRAY(String(100)), index=True)
    source_url = Column(Text)
    notes = Column(Text)
    raw_major = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_src_loc_tags", "location_tags", postgresql_using="gin"),
    )
