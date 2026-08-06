import { useSyncExternalStore } from 'react'
import type { Position } from '@/api'
import type { AppChannel } from '@/lib/badgeColors'
import { recordFavAdded, removeFavAdded } from '@/lib/favTimes'
import { daysUntil, parseSignupDeadline } from '@/lib/deadline'
import { maybeShowRemindCta } from '@/lib/remindCta'
import { reportEvent } from '@/lib/metrics'
import { removeReminder, removeRemindersByPrefix } from '@/lib/reminders'

const FAV_KEY = 'recruit.favorites'
const STATUS_KEY = 'recruit.appStatus'
const NOTE_KEY = 'recruit.appNote'
const CHANNEL_KEY = 'recruit.appChannel'
const PRIORITY_KEY = 'recruit.appPriority'
const PINNED_KEY = 'recruit.appPinned'
const STATUS_HISTORY_KEY = 'recruit.appStatusHistory'
const FAV_MAX = 200

export const APP_STATUSES = [
  '未投递',
  '已投递',
  '待笔试',
  '待面试',
  'OC/录用',
  '已放弃',
  '已挂',
] as const
export type AppStatus = (typeof APP_STATUSES)[number]

export interface StatusEvent {
  status: AppStatus | '已跟进'
  at: string
}

export const STATUS_COLORS: Record<AppStatus, string> = {
  未投递: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 [&_[data-count]]:text-slate-900 dark:[&_[data-count]]:text-slate-300',
  已投递: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 [&_[data-count]]:text-blue-900 dark:[&_[data-count]]:text-blue-300',
  待笔试: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300 [&_[data-count]]:text-cyan-900 dark:[&_[data-count]]:text-cyan-300',
  待面试: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 [&_[data-count]]:text-violet-900 dark:[&_[data-count]]:text-violet-300',
  'OC/录用': 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 [&_[data-count]]:text-green-900 dark:[&_[data-count]]:text-green-300',
  已放弃: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 [&_[data-count]]:text-amber-900 dark:[&_[data-count]]:text-amber-300',
  已挂: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 [&_[data-count]]:text-red-900 dark:[&_[data-count]]:text-red-300',
}

type Listener = () => void

function readFavorites(): Position[] {
  try {
    const raw = localStorage.getItem(FAV_KEY)
    return raw ? (JSON.parse(raw) as Position[]) : []
  } catch {
    return []
  }
}

function readStatuses(): Record<number, AppStatus> {
  try {
    const raw = localStorage.getItem(STATUS_KEY)
    return raw ? (JSON.parse(raw) as Record<number, AppStatus>) : {}
  } catch {
    return {}
  }
}

function readRecord<T>(key: string): Record<number, T> {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Record<number, T>) : {}
  } catch {
    return {}
  }
}

let favorites: Position[] = readFavorites()
let statuses: Record<number, AppStatus> = readStatuses()
let notes: Record<number, string> = readRecord<string>(NOTE_KEY)
let channels: Record<number, AppChannel> = readRecord<AppChannel>(CHANNEL_KEY)
let priorities: Record<number, boolean> = readRecord<boolean>(PRIORITY_KEY)
let pinned: Record<number, boolean> = readRecord<boolean>(PINNED_KEY)
let statusHistory: Record<number, StatusEvent[]> = readRecord<StatusEvent[]>(STATUS_HISTORY_KEY)
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l())
}

function persistFavorites() {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favorites))
  } catch {
    // ignore quota / privacy-mode errors
  }
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isFavorite(id: number): boolean {
  return favorites.some((p) => p.id === id)
}

export function toggleFavorite(item: Position) {
  if (isFavorite(item.id)) {
    favorites = favorites.filter((p) => p.id !== item.id)
    removeFavAdded('positions', item.id)
    removeReminder(`positions:${item.id}`)
  } else {
    favorites = [item, ...favorites].slice(0, FAV_MAX)
    recordFavAdded('positions', item.id)
    const d = parseSignupDeadline(item)
    if (d && daysUntil(d) >= 0) maybeShowRemindCta()
  }
  persistFavorites()
  emit()
}

export function importFavorites(items: Position[]): number {
  const fresh = items.filter((p) => !isFavorite(p.id))
  if (fresh.length === 0) return 0
  favorites = [...fresh, ...favorites].slice(0, FAV_MAX)
  persistFavorites()
  emit()
  return fresh.length
}

export function clearFavorites() {
  favorites = []
  removeRemindersByPrefix('positions:')
  persistFavorites()
  emit()
}

function persistStatuses() {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(statuses))
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function getAppStatus(id: number): AppStatus {
  return statuses[id] ?? '未投递'
}

export function setAppStatus(id: number, status: AppStatus) {
  if ((statuses[id] ?? '未投递') === status) return
  if (status === '已投递') reportEvent('apply_marked')
  if (status === '未投递') {
    const rest = { ...statuses }
    delete rest[id]
    statuses = rest
  } else {
    statuses = { ...statuses, [id]: status }
  }
  statusHistory = {
    ...statusHistory,
    [id]: [...(statusHistory[id] ?? []), { status, at: new Date().toISOString() }],
  }
  persistStatuses()
  persistRecord(STATUS_HISTORY_KEY, statusHistory)
  emit()
}

/** 投递提醒「已跟进」：只写时间线，不改当前状态。 */
export function appendFollowUp(id: number) {
  statusHistory = {
    ...statusHistory,
    [id]: [...(statusHistory[id] ?? []), { status: '已跟进', at: new Date().toISOString() }],
  }
  persistRecord(STATUS_HISTORY_KEY, statusHistory)
  emit()
}

export function useAppStatusHistory(): Record<number, StatusEvent[]> {
  return useSyncExternalStore(subscribe, () => statusHistory)
}

export function useAppStatuses(): Record<number, AppStatus> {
  return useSyncExternalStore(subscribe, () => statuses)
}

function persistRecord(key: string, value: Record<number, unknown>) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function setAppNote(id: number, note: string) {
  const trimmed = note.trim()
  if (!trimmed) {
    const rest = { ...notes }
    delete rest[id]
    notes = rest
  } else {
    notes = { ...notes, [id]: trimmed }
  }
  persistRecord(NOTE_KEY, notes)
  emit()
}

export function setAppChannel(id: number, channel: AppChannel | null) {
  if (!channel) {
    const rest = { ...channels }
    delete rest[id]
    channels = rest
  } else {
    channels = { ...channels, [id]: channel }
  }
  persistRecord(CHANNEL_KEY, channels)
  emit()
}

export function toggleAppPriority(id: number) {
  if (priorities[id]) {
    const rest = { ...priorities }
    delete rest[id]
    priorities = rest
  } else {
    priorities = { ...priorities, [id]: true }
  }
  persistRecord(PRIORITY_KEY, priorities)
  emit()
}

export function useAppPriorities(): Record<number, boolean> {
  return useSyncExternalStore(subscribe, () => priorities)
}

export function toggleAppPinned(id: number) {
  if (pinned[id]) {
    const rest = { ...pinned }
    delete rest[id]
    pinned = rest
  } else {
    pinned = { ...pinned, [id]: true }
  }
  persistRecord(PINNED_KEY, pinned)
  emit()
}

export function useAppPinned(): Record<number, boolean> {
  return useSyncExternalStore(subscribe, () => pinned)
}

export function useAppNotes(): Record<number, string> {
  return useSyncExternalStore(subscribe, () => notes)
}

export function useAppChannels(): Record<number, AppChannel> {
  return useSyncExternalStore(subscribe, () => channels)
}

export function useFavorites(): Position[] {
  return useSyncExternalStore(subscribe, () => favorites)
}

export function getFavorites(): Position[] {
  return favorites
}

export interface PositionBackup {
  favorites: Position[]
  statuses: Record<number, AppStatus>
  notes: Record<number, string>
  channels: Record<number, AppChannel>
  priorities: Record<number, boolean>
  statusHistory?: Record<number, StatusEvent[]>
  pinned?: Record<number, boolean>
}

export function exportPositionData(): PositionBackup {
  return { favorites, statuses, notes, channels, priorities, statusHistory, pinned }
}

/** 条目最后更新时间（时间线最后一条），缺则视为更早（0）。 */
export function lastEventTime(history: StatusEvent[] | undefined): number {
  if (!history || history.length === 0) return 0
  const t = new Date(history[history.length - 1].at).getTime()
  return Number.isNaN(t) ? 0 : t
}

export interface MergeStats {
  total: number
  added: number
  updated: number
}

/** 合并导入备份：同 id 按条目最后更新时间取较新者（状态/备注/优先级随条目整体走）。 */
export function mergePositionData(data: PositionBackup): MergeStats {
  const byId = new Map(favorites.map((p) => [p.id, p]))
  let added = 0
  let updated = 0
  const adopt = (id: number) => {
    if (data.statuses[id] !== undefined) statuses = { ...statuses, [id]: data.statuses[id] }
    if (data.notes[id] !== undefined) notes = { ...notes, [id]: data.notes[id] }
    if (data.channels[id] !== undefined) channels = { ...channels, [id]: data.channels[id] }
    if (data.priorities[id] !== undefined) priorities = { ...priorities, [id]: data.priorities[id] }
    if (data.statusHistory?.[id] !== undefined) statusHistory = { ...statusHistory, [id]: data.statusHistory[id] }
    if (data.pinned?.[id] !== undefined) pinned = { ...pinned, [id]: data.pinned[id] }
  }
  for (const p of data.favorites) {
    if (!byId.has(p.id)) {
      byId.set(p.id, p)
      adopt(p.id)
      added += 1
    } else if (lastEventTime(data.statusHistory?.[p.id]) > lastEventTime(statusHistory[p.id])) {
      byId.set(p.id, p)
      adopt(p.id)
      updated += 1
    }
  }
  favorites = [...byId.values()].slice(0, FAV_MAX)
  persistRecord(STATUS_HISTORY_KEY, statusHistory)
  persistRecord(PINNED_KEY, pinned)
  persistFavorites()
  persistStatuses()
  persistRecord(NOTE_KEY, notes)
  persistRecord(CHANNEL_KEY, channels)
  persistRecord(PRIORITY_KEY, priorities)
  emit()
  return { total: favorites.length, added, updated }
}
