from sqlalchemy import Column, Integer, String, Text, DateTime, Index, func
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
    search_text = Column(Text)
    content_hash = Column(String(32), index=True, unique=True, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_pos_year_job", "year", "job_type"),
        Index("idx_pos_loc_tags", "location_tags", postgresql_using="gin"),
        Index("idx_pos_search_text", "search_text", postgresql_using="gin",
              postgresql_ops={"search_text": "gin_trgm_ops"}),
    )


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
