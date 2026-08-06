import { useSyncExternalStore } from 'react'
import { getRemindNodes, REMIND_NODE_OPTIONS } from './reminderPref'

/** 单岗位截止提醒：key = board:id，节点为截止前天数（可多选），随订阅上报服务端。 */
export interface ReminderEntry {
  key: string
  /** 岗位标题（单位/公司名）快照。 */
  title: string
  /** 截止日期 YYYY-MM-DD。 */
  d: string
  /** 提醒节点（截止前天数，升序）。 */
  nodes: number[]
}

const KEY = 'recruit.jobReminders'
const EVENT = 'recruit-job-reminders-change'
const MAX = 300

function sanitizeNodes(nodes: unknown): number[] {
  if (!Array.isArray(nodes)) return []
  return REMIND_NODE_OPTIONS.filter((n) => nodes.includes(n))
}

function read(): ReminderEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    const out: ReminderEntry[] = []
    for (const e of arr) {
      if (!e || typeof e.key !== 'string' || typeof e.d !== 'string') continue
      const nodes = sanitizeNodes(e.nodes)
      if (nodes.length === 0) continue
      out.push({ key: e.key, title: typeof e.title === 'string' ? e.title : '', d: e.d, nodes })
    }
    return out
  } catch {
    return []
  }
}

let entries: ReminderEntry[] = read()

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    // ignore quota / privacy-mode errors
  }
  window.dispatchEvent(new Event(EVENT))
}

export function getReminders(): ReminderEntry[] {
  return entries
}

export function getReminder(key: string): ReminderEntry | undefined {
  return entries.find((e) => e.key === key)
}

/** 设置/更新某岗位的提醒；nodes 缺省用默认节点偏好。 */
export function setReminder(key: string, title: string, d: string, nodes?: number[]) {
  const clean = sanitizeNodes(nodes ?? getRemindNodes())
  if (clean.length === 0) return
  const entry: ReminderEntry = { key, title, d, nodes: clean }
  entries = [entry, ...entries.filter((e) => e.key !== key)].slice(0, MAX)
  persist()
}

/** 调整某岗位的提醒节点；清空节点即取消提醒。 */
export function setReminderNodes(key: string, nodes: number[]) {
  const clean = sanitizeNodes(nodes)
  if (clean.length === 0) {
    removeReminder(key)
    return
  }
  entries = entries.map((e) => (e.key === key ? { ...e, nodes: clean } : e))
  persist()
}

export function removeReminder(key: string) {
  if (!entries.some((e) => e.key === key)) return
  entries = entries.filter((e) => e.key !== key)
  persist()
}

/** 收藏板块清空时同步移除对应提醒。 */
export function removeRemindersByPrefix(prefix: string) {
  const next = entries.filter((e) => !e.key.startsWith(prefix))
  if (next.length === entries.length) return
  entries = next
  persist()
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 一键清理已截止的提醒，返回清理条数。 */
export function clearExpiredReminders(): number {
  const today = todayStr()
  const next = entries.filter((e) => e.d >= today)
  const removed = entries.length - next.length
  if (removed > 0) {
    entries = next
    persist()
  }
  return removed
}

function subscribe(cb: () => void) {
  const handler = () => cb()
  const onStorage = () => {
    entries = read()
    cb()
  }
  window.addEventListener(EVENT, handler)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, handler)
    window.removeEventListener('storage', onStorage)
  }
}

export function useReminders(): ReminderEntry[] {
  return useSyncExternalStore(subscribe, getReminders)
}
