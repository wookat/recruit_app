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

export function removeRecentSearch(keyword: string): string[] {
  const next = getRecentSearches().filter((k) => k !== keyword)
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

export function saveFilter(
  name: string,
  params: SearchParams,
): { list: SavedFilter[]; dropped: string | null } {
  const entry: SavedFilter = {
    name: name.trim(),
    params: { ...params, page: 1 },
    createdAt: Date.now(),
  }
  const rest = getSavedFilters().filter((f) => f.name !== entry.name)
  let dropped: string | null = null
  if (rest.length >= SAVED_MAX) {
    const oldest = [...rest].sort((a, b) => a.createdAt - b.createdAt)[0]
    dropped = oldest.name
    rest.splice(rest.indexOf(oldest), 1)
  }
  const list = [entry, ...rest]
  writeJson(SAVED_KEY, list)
  return { list, dropped }
}

export function deleteFilter(name: string): SavedFilter[] {
  const next = getSavedFilters().filter((f) => f.name !== name)
  writeJson(SAVED_KEY, next)
  return next
}

const SAVED_QUERY_KEY = 'recruit.savedQueries'
export const SAVED_MAX = 10

/** 板块级保存的筛选组合：内容为 URL 查询参数快照。 */
export interface SavedQuery {
  name: string
  query: string
  createdAt: number
}

type SavedQueryMap = Record<string, SavedQuery[]>

export function getSavedQueries(board: string): SavedQuery[] {
  return readJson<SavedQueryMap>(SAVED_QUERY_KEY, {})[board] ?? []
}

export function saveQuery(
  board: string,
  name: string,
  query: string,
): { list: SavedQuery[]; dropped: string | null } {
  const entry: SavedQuery = { name: name.trim(), query, createdAt: Date.now() }
  const rest = getSavedQueries(board).filter((f) => f.name !== entry.name)
  let dropped: string | null = null
  if (rest.length >= SAVED_MAX) {
    const oldest = [...rest].sort((a, b) => a.createdAt - b.createdAt)[0]
    dropped = oldest.name
    rest.splice(rest.indexOf(oldest), 1)
  }
  const list = [entry, ...rest]
  const map = readJson<SavedQueryMap>(SAVED_QUERY_KEY, {})
  map[board] = list
  writeJson(SAVED_QUERY_KEY, map)
  return { list, dropped }
}

export function deleteQuery(board: string, name: string): SavedQuery[] {
  const map = readJson<SavedQueryMap>(SAVED_QUERY_KEY, {})
  map[board] = (map[board] ?? []).filter((f) => f.name !== name)
  writeJson(SAVED_QUERY_KEY, map)
  return map[board]
}
