import { useSyncExternalStore } from 'react'

const KEY = 'recruit.remindDays'
const EVENT = 'recruit-remind-change'

export type RemindDays = 3 | 7 | 14

export const REMIND_OPTIONS: RemindDays[] = [3, 7, 14]

export function getRemindDays(): RemindDays {
  try {
    const v = Number(localStorage.getItem(KEY))
    if (v === 3 || v === 7 || v === 14) return v
  } catch {
    // ignore
  }
  return 3
}

export function setRemindDays(n: RemindDays) {
  try {
    localStorage.setItem(KEY, String(n))
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

export function useRemindDays(): RemindDays {
  return useSyncExternalStore(subscribe, getRemindDays)
}
