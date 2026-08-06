/** 上次访问时间戳（按板块记录），用于列表「新」徽章：
 * 页面加载时读取上一次的时间戳留在内存里做比较，同时把本次访问写回 localStorage。
 * 首次访问（无历史时间戳）不标任何「新」。 */

export type VisitBoard = 'positions' | 'campus' | 'bianzhi'

const KEY = 'recruit.lastVisit'

function readAll(): Partial<Record<VisitBoard, number>> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as Partial<Record<VisitBoard, number>>
    return typeof obj === 'object' && obj !== null ? obj : {}
  } catch {
    return {}
  }
}

// 模块加载（本次会话开始）时快照上一次访问时间，之后写回不影响本次比较基线
const previous: Partial<Record<VisitBoard, number>> = readAll()
const marked = new Set<VisitBoard>()

/** 记录本板块本次访问时间（重复调用只写一次）。 */
export function markBoardVisit(board: VisitBoard) {
  if (marked.has(board)) return
  marked.add(board)
  try {
    const all = readAll()
    all[board] = Date.now()
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // ignore
  }
}

/** 上次访问该板块的时间戳（毫秒；首次访问返回 null）。会话内快照，不受本次写回影响。 */
export function getPrevVisit(board: VisitBoard): number | null {
  return previous[board] ?? null
}

/** 该条目相对上次访问是否为新增（首次访问返回 false）。 */
export function isNewSinceLastVisit(
  board: VisitBoard,
  createdAt: string | null | undefined,
): boolean {
  const prev = previous[board]
  if (!prev || !createdAt) return false
  const t = new Date(createdAt).getTime()
  return Number.isFinite(t) && t > prev
}
