from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional, List


class PositionBase(BaseModel):
    year: Optional[int] = None
    job_type: Optional[str] = None
    exam_type: Optional[str] = None
    employer: Optional[str] = None
    position_example: Optional[str] = None
    edu_requirement: Optional[str] = None
    edu_level_norm: Optional[str] = None
    undergrad_major: Optional[str] = None
    grad_major: Optional[str] = None
    exam_form: Optional[str] = None
    signup_time: Optional[str] = None
    exam_time: Optional[str] = None
    special_requirements: Optional[str] = None
    work_location: Optional[str] = None
    location_tags: Optional[List[str]] = None
    source_url: Optional[str] = None
    notes: Optional[str] = None
    raw_major: Optional[str] = None
    province: Optional[str] = None
    city: Optional[str] = None
    district: Optional[str] = None
    exam_type_norm: Optional[str] = None
    college_major: Optional[str] = None


class PositionOut(PositionBase):
    id: int
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class PositionList(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[PositionOut]


class LocationNode(BaseModel):
    province: str
    cities: List[str]


class FilterOptions(BaseModel):
    years: List[int]
    job_types: List[str]
    edu_requirements: List[str]
    work_locations: List[str]
    exam_types: List[str]
    edu_levels: List[str]
    categories: List[str]
    provinces: List[str]
    location_tree: List[LocationNode]
    hot_locations: List[str]
    districts: List[str]


class StatEntry(BaseModel):
    name: str
    count: int


class StatsOut(BaseModel):
    total: int
    by_year: List[StatEntry]
    by_exam_type: List[StatEntry]
    by_province: List[StatEntry]


class TaskOut(BaseModel):
    task_id: str
    status: str
