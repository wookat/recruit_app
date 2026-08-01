import { useSyncExternalStore } from 'react'

/** 全站共享的用户画像（一键匹配条件），存 localStorage。 */
export interface UserProfile {
  eduLevel: string[]
  major: string
  location: string[]
}

const KEY = 'recruit.profile'

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function load(): UserProfile {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { eduLevel: [], major: '', location: [] }
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return { eduLevel: [], major: '', location: [] }
    const o = v as Record<string, unknown>
    return {
      eduLevel: strArr(o.eduLevel),
      major: typeof o.major === 'string' ? o.major : '',
      location: strArr(o.location),
    }
  } catch {
    return { eduLevel: [], major: '', location: [] }
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
  profile = { eduLevel: p.eduLevel, major: p.major.trim(), location: p.location }
  try {
    localStorage.setItem(KEY, JSON.stringify(profile))
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

export function clearProfile() {
  profile = { eduLevel: [], major: '', location: [] }
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

/** 画像是否已有可用于板块匹配的维度（专业或地点）。 */
export function profileUsable(p: UserProfile): boolean {
  return !!p.major.trim() || p.location.length > 0
}
