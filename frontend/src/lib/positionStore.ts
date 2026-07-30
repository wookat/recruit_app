import { useSyncExternalStore } from 'react'
import type { Position } from '@/api'

const FAV_KEY = 'recruit.favorites'
const STATUS_KEY = 'recruit.appStatus'
const FAV_MAX = 200
export const COMPARE_MAX = 4

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

export const STATUS_COLORS: Record<AppStatus, string> = {
  未投递: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  已投递: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  待笔试: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
  待面试: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  'OC/录用': 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  已放弃: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  已挂: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
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

let favorites: Position[] = readFavorites()
let statuses: Record<number, AppStatus> = readStatuses()
let compare: Position[] = []
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
  } else {
    favorites = [item, ...favorites].slice(0, FAV_MAX)
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
  persistFavorites()
  emit()
}

export function isInCompare(id: number): boolean {
  return compare.some((p) => p.id === id)
}

/** Returns false when the compare list is full and the item was not added. */
export function toggleCompare(item: Position): boolean {
  if (isInCompare(item.id)) {
    compare = compare.filter((p) => p.id !== item.id)
  } else {
    if (compare.length >= COMPARE_MAX) return false
    compare = [...compare, item]
  }
  emit()
  return true
}

export function clearCompare() {
  compare = []
  emit()
}

function persistStatuses() {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(statuses))
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function setAppStatus(id: number, status: AppStatus) {
  if (status === '未投递') {
    const rest = { ...statuses }
    delete rest[id]
    statuses = rest
  } else {
    statuses = { ...statuses, [id]: status }
  }
  persistStatuses()
  emit()
}

export function useAppStatuses(): Record<number, AppStatus> {
  return useSyncExternalStore(subscribe, () => statuses)
}

export function useFavorites(): Position[] {
  return useSyncExternalStore(subscribe, () => favorites)
}

export function useCompare(): Position[] {
  return useSyncExternalStore(subscribe, () => compare)
}
