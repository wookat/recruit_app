import { useSyncExternalStore } from 'react'
import type { StatusEvent } from '@/lib/positionStore'

/** 投递提醒：已投递超过该天数无状态变更时提示跟进。 */
export const FOLLOWUP_DAYS = 14

const DISMISS_KEY = 'recruit.followupDismissed'

function readDismissed(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

let dismissed: Record<string, string> = readDismissed()
const listeners = new Set<() => void>()

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** 忽略某条提醒：记录当时时间线末尾时间戳，状态再变更后重新可提醒。 */
export function dismissFollowUp(key: string, lastAt: string) {
  dismissed = { ...dismissed, [key]: lastAt }
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissed))
  } catch {
    // ignore quota / privacy-mode errors
  }
  listeners.forEach((l) => l())
}

export function useFollowUpDismissed(): Record<string, string> {
  return useSyncExternalStore(subscribe, () => dismissed)
}

export interface FollowUpInfo {
  days: number
  lastAt: string
}

/** 已投递且时间线最后一次记录超过 FOLLOWUP_DAYS 天、未被忽略时返回天数。 */
export function followUpInfo(
  isApplied: boolean,
  history: StatusEvent[] | undefined,
  dismissedAt: string | undefined,
): FollowUpInfo | null {
  if (!isApplied) return null
  const last = history?.[history.length - 1]?.at
  if (!last) return null
  const t = new Date(last).getTime()
  if (isNaN(t)) return null
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days < FOLLOWUP_DAYS) return null
  if (dismissedAt === last) return null
  return { days, lastAt: last }
}
