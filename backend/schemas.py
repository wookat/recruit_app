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
    signup_deadline: Optional[datetime] = None


class PositionOut(PositionBase):
    id: int
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class PositionList(BaseModel):
    total: int
    total_capped: bool = False  # True 表示 total 为封顶值（实际结果数 >= total）
    timed_out: bool = False  # True 表示查询超时被取消，结果降级为空（提示换关键词）
    total_partial: bool = False  # True 表示 count 超时降级，total 为「至少 N 条」部分值
    page: int
    page_size: int
    next_cursor: Optional[int] = None
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


class SuggestItem(BaseModel):
    word: str
    count: int


class SuggestOut(BaseModel):
    query: str
    suggestions: List[SuggestItem]


class CountItem(BaseModel):
    name: str
    count: int


class StatsOut(BaseModel):
    total: int
    by_year: List[CountItem]
    by_job_type: List[CountItem]
    by_province: List[CountItem]
    by_edu_level: List[CountItem]
    by_exam_type: List[CountItem]
    hot_keywords: List[SuggestItem]


class RecommendItem(PositionOut):
    match_score: int = 1


class RecommendOut(BaseModel):
    major: str
    expanded_terms: List[str]
    total: int
    items: List[RecommendItem]


class TaskOut(BaseModel):
    task_id: str
    status: str


class CampusExportFilters(BaseModel):
    """校招列表导出筛选（与 /api/campus 列表参数同名）。"""
    keyword: Optional[str] = None
    source_table: Optional[List[str]] = None
    company_type: Optional[List[str]] = None
    industry: Optional[List[str]] = None
    batch: Optional[str] = None
    grad_year: Optional[str] = None
    no_exam_only: bool = False
    referral_only: bool = False
    location: Optional[str] = None
    updated_after: Optional[str] = None
    due_within_days: Optional[int] = None
    hide_expired: bool = False


class BianzhiExportFilters(BaseModel):
    """编制列表导出筛选（与 /api/bianzhi 列表参数同名）。"""
    keyword: Optional[str] = None
    category: Optional[List[str]] = None
    province: Optional[List[str]] = None
    job_type: Optional[str] = None
    edu: Optional[str] = None
    updated_after: Optional[str] = None
    due_within_days: Optional[int] = None
    hide_expired: bool = False


class ExportRequest(BaseModel):
    """异步导出请求体：筛选条件 + 导出参数。"""
    year: Optional[List[int]] = None
    job_type: Optional[List[str]] = None
    exam_type: Optional[List[str]] = None
    exam_type_norm: Optional[List[str]] = None
    province: Optional[List[str]] = None
    edu_requirement: Optional[List[str]] = None
    work_location: Optional[List[str]] = None
    keyword: Optional[str] = None
    location: Optional[List[str]] = None
    edu_level: Optional[List[str]] = None
    major: Optional[str] = None
    major_type: Optional[str] = "any"
    category: Optional[List[str]] = None
    format: str = "csv"  # csv | xlsx
    sort: str = "year_desc"
    max_rows: int = 50000
    #: 导出板块：positions（默认）/ campus / bianzhi；后两者用对应嵌套筛选
    board: str = "positions"
    campus: Optional[CampusExportFilters] = None
    bianzhi: Optional[BianzhiExportFilters] = None
    #: 可选文件名（板块+筛选摘要+日期），服务端会清洗
    fname: Optional[str] = None


class FeedbackIn(BaseModel):
    """用户「举报数据有误」提交体。"""
    board: str  # positions / campus / bianzhi
    item_id: int
    issue_type: str  # link_broken / wrong_info / expired / other
    note: Optional[str] = None
