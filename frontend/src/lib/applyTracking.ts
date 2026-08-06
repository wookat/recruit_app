import { reportEvent } from '@/lib/metrics'

/** 点原文链接后的「投了吗？」回站提示：每岗位只提示一次，pending 超时不提示。 */

const PENDING_KEY = 'recruit.applyPending'
const PROMPTED_KEY = 'recruit.applyPrompted'
const PENDING_MAX_AGE_MS = 12 * 3600000
const PROMPTED_MAX = 300

export const APPLY_PROMPT_EVENT = 'recruit-apply-prompt'

export interface ApplyPending {
  key: string
  title: string
  at: string
}

function readPrompted(): Record<string, 1> {
  try {
    const raw = localStorage.getItem(PROMPTED_KEY)
    return raw ? (JSON.parse(raw) as Record<string, 1>) : {}
  } catch {
    return {}
  }
}

function wasPrompted(key: string): boolean {
  return !!readPrompted()[key]
}

function markPrompted(key: string) {
  try {
    const prompted = readPrompted()
    prompted[key] = 1
    const keys = Object.keys(prompted)
    const trimmed =
      keys.length > PROMPTED_MAX
        ? Object.fromEntries(keys.slice(keys.length - PROMPTED_MAX).map((k) => [k, 1 as const]))
        : prompted
    localStorage.setItem(PROMPTED_KEY, JSON.stringify(trimmed))
  } catch {
    // ignore
  }
}

/** 详情面板点原文链接时调用：上报 apply_click 并记录待提示岗位。 */
export function recordApplyClick(key: string, title: string) {
  reportEvent('apply_click')
  if (wasPrompted(key)) return
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ key, title, at: new Date().toISOString() } satisfies ApplyPending),
    )
  } catch {
    // ignore
  }
}

/** 回站时取走待提示岗位（取即置空并记已提示，保证每岗位只提示一次）。 */
export function takeApplyPending(): ApplyPending | null {
  let pending: ApplyPending | null = null
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    localStorage.removeItem(PENDING_KEY)
    pending = JSON.parse(raw) as ApplyPending
  } catch {
    return null
  }
  if (!pending?.key) return null
  const t = new Date(pending.at).getTime()
  if (Number.isNaN(t) || Date.now() - t > PENDING_MAX_AGE_MS) return null
  if (wasPrompted(pending.key)) return null
  markPrompted(pending.key)
  return pending
}
