import { useSyncExternalStore } from 'react'
import type { Position } from '@/api'

const FAV_KEY = 'recruit.favorites'
const FAV_MAX = 200
export const COMPARE_MAX = 4

type Listener = () => void

function readFavorites(): Position[] {
  try {
    const raw = localStorage.getItem(FAV_KEY)
    return raw ? (JSON.parse(raw) as Position[]) : []
  } catch {
    return []
  }
}

let favorites: Position[] = readFavorites()
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

export function useFavorites(): Position[] {
  return useSyncExternalStore(subscribe, () => favorites)
}

export function useCompare(): Position[] {
  return useSyncExternalStore(subscribe, () => compare)
}
