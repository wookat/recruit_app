import { pinyin } from 'pinyin-pro'

const cache = new Map<string, { full: string; initials: string }>()

function keysOf(text: string) {
  let entry = cache.get(text)
  if (!entry) {
    entry = {
      full: pinyin(text, { toneType: 'none', type: 'array' }).join('').toLowerCase(),
      initials: pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' })
        .join('')
        .toLowerCase(),
    }
    if (cache.size > 5000) cache.clear()
    cache.set(text, entry)
  }
  return entry
}

/**
 * Match Chinese text against a query that may be Chinese, full pinyin
 * (e.g. "beijing"), or pinyin initials (e.g. "bj").
 */
export function pinyinMatch(text: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (text.toLowerCase().includes(q)) return true
  if (!/^[a-z]+$/.test(q)) return false
  const { full, initials } = keysOf(text)
  return full.includes(q) || initials.includes(q)
}

/** cmdk-compatible filter: returns 1 for a match, 0 otherwise. */
export function pinyinCommandFilter(value: string, search: string): number {
  return pinyinMatch(value, search) ? 1 : 0
}
