import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL || ''

export interface Position {
  id: number
  year: number
  job_type: string
  exam_type: string
  employer: string
  position_example: string
  edu_requirement: string
  edu_level_norm: string
  undergrad_major: string
  grad_major: string
  exam_form: string
  signup_time: string
  exam_time: string
  special_requirements: string
  work_location: string
  location_tags: string[] | null
  source_url: string
  notes: string
  raw_major: string
  signup_deadline?: string | null
  created_at: string
}

export interface PositionList {
  total: number
  total_capped?: boolean
  timed_out?: boolean
  page: number
  page_size: number
  items: Position[]
}

/** 结果计数展示：封顶计数时显示 10,000+ */
export function formatTotal(total: number, capped?: boolean): string {
  return capped ? '10,000+' : total.toLocaleString()
}

export interface LocationNode {
  province: string
  cities: string[]
}

export interface FilterOptions {
  years: number[]
  job_types: string[]
  edu_requirements: string[]
  work_locations: string[]
  exam_types: string[]
  edu_levels: string[]
  categories: string[]
  provinces: string[]
  location_tree: LocationNode[]
  hot_locations: string[]
  districts: string[]
}

export interface SearchParams {
  year?: number[]
  job_type?: string[]
  exam_type?: string[]
  exam_type_norm?: string[]
  province?: string[]
  edu_requirement?: string[]
  work_location?: string[]
  keyword?: string
  // smart filters
  location?: string[]
  edu_level?: string[]
  major?: string
  major_type?: 'undergrad' | 'grad' | 'any'
  category?: string[]
  hide_expired?: boolean
  page?: number
  page_size?: number
  sort?: string
  after_id?: number
  after_year?: number
}

function toQuery(params: object) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) {
      value.forEach((v) => q.append(key, String(v)))
    } else {
      q.append(key, String(value))
    }
  })
  return q.toString()
}

// ---------- 校招/社招信息 ----------
export interface CampusJob {
  id: number
  source_table: string | null
  company: string | null
  positions: string | null
  company_type: string | null
  industry: string | null
  batch: string | null
  grad_years: string | null
  no_exam: string | null
  edu_requirement: string | null
  major_requirement: string | null
  locations: string | null
  start_date: string | null
  deadline_text: string | null
  announce_url: string | null
  apply_url: string | null
  referral_code: string | null
  notes: string | null
  updated_at_src: string | null
  deadline_date: string | null
}

export interface CampusList {
  total: number
  page: number
  page_size: number
  items: CampusJob[]
}

export interface CampusParams {
  keyword?: string
  source_table?: string[]
  company_type?: string[]
  industry?: string[]
  batch?: string
  grad_year?: string
  no_exam_only?: boolean
  referral_only?: boolean
  location?: string
  updated_after?: string
  due_within_days?: number
  hide_expired?: boolean
  page?: number
  page_size?: number
}

export interface CampusFilterOptions {
  source_tables: Record<string, number>
  company_types: string[]
  industries: string[]
  batches: string[]
  grad_years: string[]
}

export async function fetchCampusJobs(params: CampusParams, signal?: AbortSignal): Promise<CampusList> {
  const res = await axios.get(`${API_BASE}/api/campus?${toQuery(params)}`, { signal })
  return res.data
}

export async function fetchCampusJob(id: number): Promise<CampusJob> {
  const res = await axios.get(`${API_BASE}/api/campus/${id}`)
  return res.data
}

export async function fetchCampusFilters(): Promise<CampusFilterOptions> {
  const res = await axios.get(`${API_BASE}/api/campus/filters`)
  return res.data
}

// ---------- 编制公告（公务员事业单位/教育/医疗/高校/科研院所/央国企社招/大型联考） ----------
export interface BianzhiJob {
  id: number
  category: string | null
  province: string | null
  employer: string | null
  headcount: string | null
  job_type: string | null
  work_location: string | null
  edu_requirement: string | null
  major_requirement: string | null
  deadline_text: string | null
  signup_start: string | null
  exam_time: string | null
  notes: string | null
  announce_url: string | null
  apply_url: string | null
  updated_at_src: string | null
  deadline_date: string | null
}

export interface BianzhiList {
  total: number
  page: number
  page_size: number
  items: BianzhiJob[]
}

export interface BianzhiParams {
  keyword?: string
  category?: string[]
  province?: string[]
  job_type?: string
  edu?: string
  updated_after?: string
  due_within_days?: number
  hide_expired?: boolean
  page?: number
  page_size?: number
}

export interface BianzhiFilterOptions {
  categories: Record<string, number>
  provinces: string[]
}

export async function fetchBianzhiJobs(params: BianzhiParams, signal?: AbortSignal): Promise<BianzhiList> {
  const res = await axios.get(`${API_BASE}/api/bianzhi?${toQuery(params)}`, { signal })
  return res.data
}

export async function fetchBianzhiJob(id: number): Promise<BianzhiJob> {
  const res = await axios.get(`${API_BASE}/api/bianzhi/${id}`)
  return res.data
}

export async function fetchBianzhiFilters(): Promise<BianzhiFilterOptions> {
  const res = await axios.get(`${API_BASE}/api/bianzhi/filters`)
  return res.data
}

// ---------- 数据新鲜度 ----------
export interface Freshness {
  positions: { last_success: string | null }
  campus: { last_success: string | null }
  bianzhi: { last_success: string | null }
}

let freshnessPromise: Promise<Freshness> | null = null

/** 全站只请求一次（模块级缓存），失败后不重试。 */
export function fetchFreshness(): Promise<Freshness> {
  if (!freshnessPromise) {
    freshnessPromise = axios.get(`${API_BASE}/api/freshness`).then((r) => r.data)
  }
  return freshnessPromise
}

// ---------- chips 计数 ----------
export interface BianzhiCounts {
  categories: Record<string, number>
  provinces: Record<string, number>
}

export interface CampusCounts {
  company_types: Record<string, number>
  batches: Record<string, number>
}

let bianzhiCountsPromise: Promise<BianzhiCounts | null> | null = null
let campusCountsPromise: Promise<CampusCounts | null> | null = null

/** 模块级缓存单次请求，失败静默返回 null。 */
export function fetchBianzhiCounts(): Promise<BianzhiCounts | null> {
  if (!bianzhiCountsPromise) {
    bianzhiCountsPromise = axios
      .get(`${API_BASE}/api/bianzhi/counts`)
      .then((r) => r.data)
      .catch(() => null)
  }
  return bianzhiCountsPromise
}

/** 模块级缓存单次请求，失败静默返回 null。 */
export function fetchCampusCounts(): Promise<CampusCounts | null> {
  if (!campusCountsPromise) {
    campusCountsPromise = axios
      .get(`${API_BASE}/api/campus/counts`)
      .then((r) => r.data)
      .catch(() => null)
  }
  return campusCountsPromise
}

export async function fetchPositions(params: SearchParams, signal?: AbortSignal): Promise<PositionList> {
  const res = await axios.get(`${API_BASE}/api/positions?${toQuery(params)}`, { signal })
  return res.data
}

export async function fetchSources(params: SearchParams, signal?: AbortSignal): Promise<PositionList> {
  const res = await axios.get(`${API_BASE}/api/sources?${toQuery(params)}`, { signal })
  return res.data
}

export async function fetchFilters(): Promise<FilterOptions> {
  const res = await axios.get(`${API_BASE}/api/filters`)
  return res.data
}

export interface StatEntry {
  name: string
  count: number
}

export interface Stats {
  total: number
  by_year: StatEntry[]
  by_exam_type: StatEntry[]
  by_province: StatEntry[]
}

export async function fetchStats(): Promise<Stats> {
  const res = await axios.get(`${API_BASE}/api/stats`)
  return res.data
}

export interface Suggestion {
  text: string
  type?: string
  count?: number
}

export async function fetchSuggestions(q: string, limit = 8): Promise<Suggestion[]> {
  const res = await axios.get(`${API_BASE}/api/suggest`, { params: { q, limit } })
  const data = res.data
  const raw: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.suggestions)
    ? data.suggestions
    : Array.isArray(data?.items)
    ? data.items
    : []
  return raw
    .map((item): Suggestion | null => {
      if (typeof item === 'string') return { text: item }
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        const text = obj.text ?? obj.word ?? obj.keyword ?? obj.value ?? obj.name
        if (typeof text === 'string' && text) {
          return {
            text,
            type: typeof obj.type === 'string' ? obj.type : undefined,
            count: typeof obj.count === 'number' ? obj.count : undefined,
          }
        }
      }
      return null
    })
    .filter((s): s is Suggestion => s !== null)
    .slice(0, limit)
}

export async function fetchPosition(id: number): Promise<Position> {
  const res = await axios.get(`${API_BASE}/api/positions/${id}`)
  return res.data
}

export interface DeadlineEntry {
  position: Position | null
  title: string
  employer: string
  deadline: string
  daysLeft: number | null
}

function parseDeadlineEntry(item: unknown): DeadlineEntry | null {
  if (!item || typeof item !== 'object') return null
  const obj = item as Record<string, unknown>
  const deadline =
    obj.signup_deadline ?? obj.deadline ?? obj.signup_end ?? obj.end_date ?? obj.signup_time
  if (typeof deadline !== 'string' || !deadline) return null
  const title = obj.position_example ?? obj.title ?? obj.exam_type ?? ''
  const employer = obj.employer ?? ''
  const daysLeft = obj.days_left ?? obj.daysLeft
  const isPosition = typeof obj.id === 'number' && 'year' in obj
  return {
    position: isPosition ? (obj as unknown as Position) : null,
    title: typeof title === 'string' ? title : '',
    employer: typeof employer === 'string' ? employer : '',
    deadline,
    daysLeft: typeof daysLeft === 'number' ? daysLeft : null,
  }
}

export async function fetchDeadlines(days = 7, limit = 20): Promise<DeadlineEntry[]> {
  const res = await axios.get(`${API_BASE}/api/deadlines`, { params: { days, limit } })
  const data = res.data
  const raw: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.deadlines)
    ? data.deadlines
    : []
  return raw
    .map(parseDeadlineEntry)
    .filter((e): e is DeadlineEntry => e !== null)
    .slice(0, limit)
}

export interface RecommendItem extends Position {
  match_score: number
}

export interface RecommendResult {
  major: string
  expanded_terms: string[]
  total: number
  items: RecommendItem[]
}

export async function fetchRecommend(params: {
  major: string
  edu_level?: string[]
  location?: string[]
  category?: string[]
  year?: number[]
  limit?: number
}): Promise<RecommendResult> {
  const res = await axios.get(`${API_BASE}/api/recommend?${toQuery(params)}`)
  return res.data
}

export function buildExportUrl(params: SearchParams, format: 'csv' | 'xlsx'): string {
  const { page: _p, page_size: _ps, after_id: _a, after_year: _ay, ...rest } = params
  const qs = toQuery(rest)
  return `${API_BASE}/api/export?format=${format}${qs ? `&${qs}` : ''}`
}

export interface ExportStatus {
  task_id: string
  status: string
  file?: string
  rows?: number
  error?: string
}

export async function createExport(
  params: SearchParams,
  format: 'csv' | 'xlsx',
  maxRows: number,
): Promise<{ task_id: string }> {
  const body = {
    year: params.year,
    job_type: params.job_type,
    exam_type: params.exam_type,
    exam_type_norm: params.exam_type_norm,
    province: params.province,
    edu_requirement: params.edu_requirement,
    work_location: params.work_location,
    keyword: params.keyword || undefined,
    location: params.location,
    edu_level: params.edu_level,
    major: params.major || undefined,
    major_type: params.major_type,
    category: params.category,
    format,
    sort: params.sort || 'year_desc',
    max_rows: maxRows,
  }
  const res = await axios.post(`${API_BASE}/api/export`, body)
  return res.data
}

export async function fetchExportStatus(taskId: string): Promise<ExportStatus> {
  const res = await axios.get(`${API_BASE}/api/export/status/${taskId}`)
  return res.data
}

export function exportDownloadUrl(taskId: string): string {
  return `${API_BASE}/api/export/download/${taskId}`
}

export async function triggerScrape(
  token: string,
  year: number,
): Promise<{ task_id: string; status: string }> {
  const res = await axios.post(
    `${API_BASE}/api/admin/scrape/${year}`,
    {},
    { headers: { 'X-Admin-Token': token } },
  )
  return res.data
}

export async function fetchTaskStatus(
  token: string,
  taskId: string,
): Promise<{ task_id: string; status: string; info: any }> {
  const res = await axios.get(`${API_BASE}/api/admin/task/${taskId}`, {
    headers: { 'X-Admin-Token': token },
  })
  return res.data
}

// ---- 管理后台 ----
export interface AdminOverview {
  positions: { total: number; clean: number; dup: number; invalid: number }
  by_year: { year: number; count: number }[]
  watch_sources: { total: number; enabled: number; error: number }
  announcements: { new: number; total: number }
}

export interface WatchSource {
  id: number
  name: string
  index_url: string
  keywords: string | null
  category: string | null
  year: number | null
  enabled: number
  interval_minutes: number
  last_checked_at: string | null
  last_status: string | null
  last_message: string | null
}

export interface Announcement {
  id: number
  source_id: number | null
  title: string
  url: string
  status: string
  detected_at: string | null
}

export interface CrawlRun {
  id: number
  source_id: number | null
  started_at: string | null
  finished_at: string | null
  status: string
  announcements_found: number
  attachments_downloaded: number
  rows_parsed: number
  rows_ingested: number
  error: string | null
}

export interface CrawlRunList {
  total: number
  page: number
  page_size: number
  items: CrawlRun[]
}

export interface HealthSourceRun {
  source_id: number
  source_name?: string
  status: string
  started_at: string | null
  duration_seconds: number | null
  rows_ingested: number
}

export interface HealthSummary {
  crawl_24h: {
    success: number
    failed: number
    total: number
    latest_by_source: HealthSourceRun[]
  }
  failed_sources_yesterday: {
    at: string | null
    sources: string[]
  }
  cache_ttl_seconds: {
    stats: number
    filters: number
    dq_report: number
  }
  table_estimates: Record<string, number>
  data_quality: {
    generated_at: string | null
    rows: { total: number; clean: number; dup: number; invalid: number; added_last_7d: number } | null
    deadline_parse_rate: number | null
  } | null
  trend?: HealthTrendDay[] | null
}

export interface HealthTrendDay {
  date: string
  crawl_success: number
  crawl_fail: number
  campus_added: number
  bianzhi_added: number
}

function adminHeaders(token: string) {
  return { headers: { 'X-Admin-Token': token } }
}

export async function fetchHealthSummary(token: string): Promise<HealthSummary> {
  const res = await axios.get(`${API_BASE}/api/admin/health-summary`, adminHeaders(token))
  return res.data
}

export async function adminOverview(token: string): Promise<AdminOverview> {
  const res = await axios.get(`${API_BASE}/api/admin/overview`, adminHeaders(token))
  return res.data
}

export interface QualityIssueSample {
  id: number
  value: string
}

export interface QualityIssue {
  board: 'positions' | 'campus' | 'bianzhi'
  key: string
  label: string
  count: number
  samples: QualityIssueSample[]
}

export interface QualityIssues {
  generated_at: string
  total: number
  issues: QualityIssue[]
}

export async function fetchQualityIssues(token: string): Promise<QualityIssues> {
  const res = await axios.get(`${API_BASE}/api/admin/quality-issues`, adminHeaders(token))
  return res.data
}

export async function fetchCrawlRuns(token: string, page = 1, pageSize = 20): Promise<CrawlRunList> {
  const res = await axios.get(`${API_BASE}/api/admin/crawl-runs`, {
    params: { page, page_size: pageSize },
    ...adminHeaders(token),
  })
  return res.data
}

export async function adminListSources(token: string): Promise<WatchSource[]> {
  const res = await axios.get(`${API_BASE}/api/admin/watch-sources`, adminHeaders(token))
  return res.data
}

export async function adminUpdateSource(
  token: string,
  id: number,
  body: Omit<WatchSource, 'id' | 'last_checked_at' | 'last_status' | 'last_message'>,
): Promise<WatchSource> {
  const res = await axios.patch(`${API_BASE}/api/admin/watch-sources/${id}`, body, adminHeaders(token))
  return res.data
}

export async function adminCheckSource(
  token: string,
  id: number,
): Promise<{ source: string; status: string; new: number }> {
  const res = await axios.post(`${API_BASE}/api/admin/watch-sources/${id}/check`, {}, adminHeaders(token))
  return res.data
}

export async function adminSeedSources(token: string): Promise<{ added: number }> {
  const res = await axios.post(`${API_BASE}/api/admin/watch-sources/seed`, {}, adminHeaders(token))
  return res.data
}

export async function adminListAnnouncements(
  token: string,
  status?: string,
): Promise<Announcement[]> {
  const qs = status ? `?status=${status}` : ''
  const res = await axios.get(`${API_BASE}/api/admin/announcements${qs}`, adminHeaders(token))
  return res.data
}

export async function adminSetAnnouncementStatus(
  token: string,
  id: number,
  status: string,
): Promise<Announcement> {
  const res = await axios.patch(`${API_BASE}/api/admin/announcements/${id}`, { status }, adminHeaders(token))
  return res.data
}
