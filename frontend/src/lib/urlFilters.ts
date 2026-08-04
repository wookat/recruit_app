import type { SearchParams } from '@/api'

const ARRAY_KEYS = [
  'year',
  'job_type',
  'exam_type',
  'exam_type_norm',
  'province',
  'edu_requirement',
  'work_location',
  'location',
  'edu_level',
  'category',
] as const

const STRING_KEYS = ['keyword', 'major', 'major_type', 'sort'] as const

/** 体制内板块占用的全部 URL 筛选参数名（含旧 hide_expired 兼容）。 */
export const POSITION_URL_KEYS: readonly string[] = [
  ...ARRAY_KEYS,
  ...STRING_KEYS,
  'hexp',
  'hide_expired',
]

export function paramsToQueryString(params: SearchParams): string {
  const q = new URLSearchParams()
  for (const key of ARRAY_KEYS) {
    for (const v of params[key] || []) q.append(key, String(v))
  }
  for (const key of STRING_KEYS) {
    const v = params[key]
    if (v && !(key === 'major_type' && v === 'any') && !(key === 'sort' && v === 'year_desc')) {
      q.set(key, String(v))
    }
  }
  if (params.hide_expired) q.set('hexp', '1')
  return q.toString()
}

export function paramsFromQueryString(search: string): Partial<SearchParams> {
  const q = new URLSearchParams(search)
  const out: Partial<SearchParams> = {}
  for (const key of ARRAY_KEYS) {
    // 过滤纯符号/空白等非法值（如 ?edu_level=/），避免产生无意义筛选 chip
    const values = q.getAll(key).filter((v) => v && /[\u4e00-\u9fa5A-Za-z0-9]/.test(v))
    if (values.length === 0) continue
    if (key === 'year') {
      const years = values.map(Number).filter((n) => !isNaN(n))
      if (years.length) out.year = years
    } else {
      out[key] = values
    }
  }
  const keyword = q.get('keyword')
  if (keyword) out.keyword = keyword
  const major = q.get('major')
  if (major) out.major = major
  const majorType = q.get('major_type')
  if (majorType === 'undergrad' || majorType === 'grad' || majorType === 'any') {
    out.major_type = majorType
  }
  const sort = q.get('sort')
  if (sort) out.sort = sort
  if (q.get('hexp') === '1' || q.get('hide_expired') === '1') out.hide_expired = true
  return out
}

export function buildShareUrl(params: SearchParams): string {
  const qs = paramsToQueryString(params)
  const base = `${window.location.origin}${window.location.pathname}`
  return qs ? `${base}?${qs}` : base
}
