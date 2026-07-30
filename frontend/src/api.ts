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
  created_at: string
}

export interface PositionList {
  total: number
  page: number
  page_size: number
  items: Position[]
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

export async function fetchPositions(params: SearchParams): Promise<PositionList> {
  const res = await axios.get(`${API_BASE}/api/positions?${toQuery(params)}`)
  return res.data
}

export async function fetchSources(params: SearchParams): Promise<PositionList> {
  const res = await axios.get(`${API_BASE}/api/sources?${toQuery(params)}`)
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

export async function triggerScrape(year: number): Promise<{ task_id: string; status: string }> {
  const res = await axios.post(`${API_BASE}/api/admin/scrape/${year}`)
  return res.data
}

export async function fetchTaskStatus(
  taskId: string,
): Promise<{ task_id: string; status: string; info: any }> {
  const res = await axios.get(`${API_BASE}/api/admin/task/${taskId}`)
  return res.data
}
