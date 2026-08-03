// pinyin-pro 体积大（~300KB），懒加载：首次遇到拉丁查询才加载，
// 加载完成前退化为普通子串匹配，不阻塞首屏 JS。
type PinyinFn = typeof import('pinyin-pro').pinyin

let pinyinFn: PinyinFn | null = null
let loading = false

function ensurePinyin() {
  if (pinyinFn || loading) return
  loading = true
  void import('pinyin-pro').then((m) => {
    pinyinFn = m.pinyin
  })
}

/** 提前加载拼音词典（如选择器展开时），避免首次拉丁查询因词典未就绪而无匹配。 */
export function preloadPinyin() {
  ensurePinyin()
}

const cache = new Map<string, { full: string; initials: string }>()

function keysOf(text: string, py: PinyinFn) {
  let entry = cache.get(text)
  if (!entry) {
    entry = {
      full: py(text, { toneType: 'none', type: 'array' }).join('').toLowerCase(),
      initials: py(text, { pattern: 'first', toneType: 'none', type: 'array' })
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
  if (!pinyinFn) {
    ensurePinyin()
    return false
  }
  const { full, initials } = keysOf(text, pinyinFn)
  return full.includes(q) || initials.includes(q)
}

/** cmdk-compatible filter: returns 1 for a match, 0 otherwise. */
export function pinyinCommandFilter(value: string, search: string): number {
  return pinyinMatch(value, search) ? 1 : 0
}
