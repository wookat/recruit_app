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
}

function toQuery(params: SearchParams) {
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
