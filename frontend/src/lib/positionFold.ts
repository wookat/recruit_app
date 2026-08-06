import type { Position } from '@/api'

/** 体制内列表：相邻的同岗位名+同单位多地区行折叠为一行（同 R232 全部岗位页折叠口径）。 */
export function positionGroupKey(p: Position): string | null {
  const title = (p.position_example || '').trim()
  const employer = (p.employer || '').trim()
  if (!title || !employer) return null
  return `${title}|${employer}`
}

function locationOf(p: Position): string {
  return p.work_location || p.province || ''
}

export interface PositionFoldGroup {
  key: string
  count: number
  locations: string[]
}

export interface FoldedPositions {
  rows: Position[]
  /** 折叠组代表行 id → 组信息 */
  groups: Map<number, PositionFoldGroup>
  collapsedGroups: number
  hiddenRows: number
}

export function foldPositions(items: Position[], expanded: Set<string>): FoldedPositions {
  const rows: Position[] = []
  const groups = new Map<number, PositionFoldGroup>()
  let collapsedGroups = 0
  let hiddenRows = 0
  let i = 0
  while (i < items.length) {
    const key = positionGroupKey(items[i])
    let j = i + 1
    while (j < items.length && key !== null && positionGroupKey(items[j]) === key) j++
    const run = items.slice(i, j)
    if (run.length > 1 && key !== null && !expanded.has(key)) {
      const locations = [...new Set(run.map(locationOf).filter(Boolean))]
      rows.push(run[0])
      groups.set(run[0].id, { key, count: run.length, locations })
      collapsedGroups++
      hiddenRows += run.length - 1
    } else {
      rows.push(...run)
    }
    i = j
  }
  return { rows, groups, collapsedGroups, hiddenRows }
}
