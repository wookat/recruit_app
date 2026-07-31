from sqlalchemy import Column, Date, Integer, String, Text, DateTime, Index, func
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
