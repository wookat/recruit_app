import { useSyncExternalStore } from 'react'

const LEGACY_KEY = 'recruit.remindDays'
const NODES_KEY = 'recruit.remindNodes'
const EVENT = 'recruit-remind-change'

/** 截止提醒节点：截止前 N 天各提醒一次，可多选。 */
export const REMIND_NODE_OPTIONS = [1, 3, 7] as const
export type RemindNode = (typeof REMIND_NODE_OPTIONS)[number]

function readNodes(): RemindNode[] {
  try {
    const raw = localStorage.getItem(NODES_KEY)
    if (raw) {
      const arr: unknown = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const nodes = REMIND_NODE_OPTIONS.filter((n) => arr.includes(n))
        if (nodes.length > 0) return nodes
      }
    }
    // 旧版单值偏好：3/7 沿用，14 映射为 7
    const legacy = Number(localStorage.getItem(LEGACY_KEY))
    if (legacy === 3 || legacy === 7) return [legacy]
    if (legacy === 14) return [7]
  } catch {
    // ignore
  }
  return [3]
}

let cache: RemindNode[] | null = null

/** 默认提醒节点（升序、非空，默认 [3]）。 */
export function getRemindNodes(): RemindNode[] {
  if (!cache) cache = readNodes()
  return cache
}

export function setRemindNodes(nodes: number[]) {
  const next = REMIND_NODE_OPTIONS.filter((n) => nodes.includes(n))
  try {
    localStorage.setItem(NODES_KEY, JSON.stringify(next.length > 0 ? next : [3]))
  } catch {
    // ignore
  }
  cache = null
  window.dispatchEvent(new Event(EVENT))
}

/** 节点文案 "1/3/7"。 */
export function formatNodes(nodes: number[]): string {
  return nodes.join('/')
}

/** 最大提醒节点天数：顶栏红点、横幅与本地通知的时间窗。 */
export function getRemindDays(): number {
  return Math.max(...getRemindNodes())
}

function subscribe(cb: () => void) {
  const handler = () => {
    cache = null
    cb()
  }
  window.addEventListener(EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

export function useRemindNodes(): RemindNode[] {
  return useSyncExternalStore(subscribe, getRemindNodes)
}

export function useRemindDays(): number {
  return useSyncExternalStore(subscribe, getRemindDays)
}
