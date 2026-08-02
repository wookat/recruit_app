import { useSyncExternalStore } from 'react'

export type HistoryBoard = 'positions' | 'campus' | 'bianzhi'

export interface ViewHistoryEntry {
  board: HistoryBoard
  id: number
  title: string
  at: string
}

const KEY = 'recruit.viewHistory'
const MAX = 30

type Listener = () => void

function read(): ViewHistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as ViewHistoryEntry[]) : []
    return Array.isArray(list) ? list.slice(0, MAX) : []
  } catch {
    return []
  }
}

function write(list: ViewHistoryEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // ignore quota / privacy-mode errors
  }
}

let history: ViewHistoryEntry[] = read()
let seenSet: Set<string> = new Set(history.map((e) => `${e.board}:${e.id}`))

const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setHistory(next: ViewHistoryEntry[]) {
  history = next
  seenSet = new Set(next.map((e) => `${e.board}:${e.id}`))
  write(next)
  emit()
}

/** 记录一次岗位查看（去重置顶，最多 30 条，仅存本地）。 */
export function addViewHistory(board: HistoryBoard, id: number, title: string) {
  if (!id || !title) return
  const rest = history.filter((e) => !(e.board === board && e.id === id))
  setHistory([{ board, id, title, at: new Date().toISOString() }, ...rest].slice(0, MAX))
}

export function removeViewHistory(board: HistoryBoard, id: number) {
  setHistory(history.filter((e) => !(e.board === board && e.id === id)))
}

export function clearViewHistory() {
  setHistory([])
}

export function useViewHistory(): ViewHistoryEntry[] {
  return useSyncExternalStore(subscribe, () => history)
}

/** 已看过查表 Set（key 为 `${board}:${id}`），大列表 O(1) 判断。 */
export function useSeenSet(): Set<string> {
  return useSyncExternalStore(subscribe, () => seenSet)
}
