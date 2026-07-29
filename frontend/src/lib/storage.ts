import type { SearchParams } from '@/api'

const RECENT_KEY = 'recruit.recentSearches'
const SAVED_KEY = 'recruit.savedFilters'
const RECENT_MAX = 8

export interface SavedFilter {
  name: string
  params: SearchParams
  createdAt: number
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function getRecentSearches(): string[] {
  return readJson<string[]>(RECENT_KEY, [])
}

export function addRecentSearch(keyword: string): string[] {
  const kw = keyword.trim()
  if (!kw) return getRecentSearches()
  const next = [kw, ...getRecentSearches().filter((k) => k !== kw)].slice(0, RECENT_MAX)
  writeJson(RECENT_KEY, next)
  return next
}

export function clearRecentSearches(): string[] {
  writeJson(RECENT_KEY, [])
  return []
}

export function getSavedFilters(): SavedFilter[] {
  return readJson<SavedFilter[]>(SAVED_KEY, [])
}

export function saveFilter(name: string, params: SearchParams): SavedFilter[] {
  const entry: SavedFilter = {
    name: name.trim(),
    params: { ...params, page: 1 },
    createdAt: Date.now(),
  }
  const next = [entry, ...getSavedFilters().filter((f) => f.name !== entry.name)].slice(0, 20)
  writeJson(SAVED_KEY, next)
  return next
}

export function deleteFilter(name: string): SavedFilter[] {
  const next = getSavedFilters().filter((f) => f.name !== name)
  writeJson(SAVED_KEY, next)
  return next
}
