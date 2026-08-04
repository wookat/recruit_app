import { useSyncExternalStore } from 'react'

/** 全站共享的用户画像（一键匹配条件），存 localStorage。 */
export interface UserProfile {
  eduLevel: string[]
  /** 兼容字段：首个专业（旧版本单专业）。 */
  major: string
  /** 专业（支持多个）。 */
  majors: string[]
  location: string[]
  /** 应届年份，如「2026届」；空为不限。 */
  gradYear: string
  /** 意向单位类型（校招 company_type / 编制 category）。 */
  unitTypes: string[]
}

const EMPTY: UserProfile = {
  eduLevel: [],
  major: '',
  majors: [],
  location: [],
  gradYear: '',
  unitTypes: [],
}

const KEY = 'recruit.profile'

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function load(): UserProfile {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...EMPTY }
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return { ...EMPTY }
    const o = v as Record<string, unknown>
    const major = typeof o.major === 'string' ? o.major : ''
    const majors = strArr(o.majors)
    return {
      eduLevel: strArr(o.eduLevel),
      major: majors[0] ?? major,
      majors: majors.length ? majors : major.trim() ? [major.trim()] : [],
      location: strArr(o.location),
      gradYear: typeof o.gradYear === 'string' ? o.gradYear : '',
      unitTypes: strArr(o.unitTypes),
    }
  } catch {
    return { ...EMPTY }
  }
}

let profile: UserProfile = load()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getProfile(): UserProfile {
  return profile
}

export function saveProfile(p: UserProfile) {
  const majors = p.majors.map((m) => m.trim()).filter(Boolean).slice(0, 5)
  profile = {
    eduLevel: p.eduLevel,
    major: majors[0] ?? p.major.trim(),
    majors,
    location: p.location,
    gradYear: p.gradYear.trim(),
    unitTypes: p.unitTypes,
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(profile))
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

export function clearProfile() {
  profile = { ...EMPTY }
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

export function useProfile(): UserProfile {
  return useSyncExternalStore(subscribe, () => profile)
}

/** 画像学历枚举（本科/硕士研究生/博士研究生/大专/中专）归一到校招/编制板块的学历选项（本科/硕士/博士/大专）。 */
export function profileEduToBoardOption(eduLevel: string[]): string | null {
  for (const e of eduLevel) {
    if (e.includes('本科')) return '本科'
    if (e.startsWith('硕士')) return '硕士'
    if (e.startsWith('博士')) return '博士'
    if (e.includes('大专') || e.includes('中专')) return '大专'
  }
  return null
}

/** 画像是否已有可用于板块匹配的维度（专业或地点）。 */
export function profileUsable(p: UserProfile): boolean {
  return p.majors.length > 0 || !!p.major.trim() || p.location.length > 0
}
