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
