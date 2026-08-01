export type SortDir = 'asc' | 'desc'

export interface SortState {
  key: string
  dir: SortDir
}

/** 点击列头循环：升序 → 降序 → 取消。 */
export function nextSort(prev: SortState | null, key: string): SortState | null {
  if (prev?.key !== key) return { key, dir: 'asc' }
  return prev.dir === 'asc' ? { key, dir: 'desc' } : null
}

/** 可空字符串比较：空值始终排后，与排序方向无关。 */
export function cmpNullableStr(
  a: string | null | undefined,
  b: string | null | undefined,
  dir: SortDir,
): number {
  const av = a?.trim() || null
  const bv = b?.trim() || null
  if (!av && !bv) return 0
  if (!av) return 1
  if (!bv) return -1
  const base = av.localeCompare(bv, 'zh-Hans-CN')
  return dir === 'asc' ? base : -base
}

/** 日期字符串归一化：分隔符统一为 -，年月日补零，便于字典序即时间序。 */
export function normalizeDateStr(s: string | null | undefined): string | null {
  if (!s) return null
  const m = s.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (!m) return s
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}
