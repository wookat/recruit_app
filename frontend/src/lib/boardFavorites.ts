import { useSyncExternalStore } from 'react'
import type { BianzhiJob, CampusJob } from '@/api'
import type { AppStatus, StatusEvent } from '@/lib/positionStore'
import { recordFavAdded, removeFavAdded } from '@/lib/favTimes'

export type BoardKind = 'campus' | 'bianzhi'

export interface BoardMeta {
  status?: AppStatus
  note?: string
  priority?: boolean
  pinned?: boolean
  history?: StatusEvent[]
}

const FAV_KEYS: Record<BoardKind, string> = {
  campus: 'recruit.campusFavorites',
  bianzhi: 'recruit.bianzhiFavorites',
}
const META_KEYS: Record<BoardKind, string> = {
  campus: 'recruit.campusFavMeta',
  bianzhi: 'recruit.bianzhiFavMeta',
}
const FAV_MAX = 200

type Listener = () => void

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota / privacy-mode errors
  }
}

let campusFavorites: CampusJob[] = readJson<CampusJob[]>(FAV_KEYS.campus, [])
let bianzhiFavorites: BianzhiJob[] = readJson<BianzhiJob[]>(FAV_KEYS.bianzhi, [])
let campusMeta: Record<number, BoardMeta> = readJson<Record<number, BoardMeta>>(
  META_KEYS.campus,
  {},
)
let bianzhiMeta: Record<number, BoardMeta> = readJson<Record<number, BoardMeta>>(
  META_KEYS.bianzhi,
  {},
)

const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isCampusFavorite(id: number): boolean {
  return campusFavorites.some((j) => j.id === id)
}

export function toggleCampusFavorite(item: CampusJob) {
  if (isCampusFavorite(item.id)) {
    campusFavorites = campusFavorites.filter((j) => j.id !== item.id)
    removeFavAdded('campus', item.id)
  } else {
    campusFavorites = [item, ...campusFavorites].slice(0, FAV_MAX)
    recordFavAdded('campus', item.id)
  }
  writeJson(FAV_KEYS.campus, campusFavorites)
  emit()
}

export function isBianzhiFavorite(id: number): boolean {
  return bianzhiFavorites.some((j) => j.id === id)
}

export function toggleBianzhiFavorite(item: BianzhiJob) {
  if (isBianzhiFavorite(item.id)) {
    bianzhiFavorites = bianzhiFavorites.filter((j) => j.id !== item.id)
    removeFavAdded('bianzhi', item.id)
  } else {
    bianzhiFavorites = [item, ...bianzhiFavorites].slice(0, FAV_MAX)
    recordFavAdded('bianzhi', item.id)
  }
  writeJson(FAV_KEYS.bianzhi, bianzhiFavorites)
  emit()
}

function metaOf(kind: BoardKind): Record<number, BoardMeta> {
  return kind === 'campus' ? campusMeta : bianzhiMeta
}

function setMeta(kind: BoardKind, next: Record<number, BoardMeta>) {
  if (kind === 'campus') campusMeta = next
  else bianzhiMeta = next
  writeJson(META_KEYS[kind], next)
  emit()
}

function patchMeta(kind: BoardKind, id: number, patch: Partial<BoardMeta>) {
  const current = metaOf(kind)
  const merged: BoardMeta = { ...current[id], ...patch }
  if (!merged.status && !merged.note && !merged.priority && !merged.pinned && !merged.history?.length) {
    const rest = { ...current }
    delete rest[id]
    setMeta(kind, rest)
  } else {
    setMeta(kind, { ...current, [id]: merged })
  }
}

export function setBoardStatus(kind: BoardKind, id: number, status: AppStatus) {
  const current = metaOf(kind)[id]
  if ((current?.status ?? '未投递') === status) return
  patchMeta(kind, id, {
    status: status === '未投递' ? undefined : status,
    history: [...(current?.history ?? []), { status, at: new Date().toISOString() }],
  })
}

/** 投递提醒「已跟进」：只写时间线，不改当前状态。 */
export function appendBoardFollowUp(kind: BoardKind, id: number) {
  const current = metaOf(kind)[id]
  patchMeta(kind, id, {
    history: [...(current?.history ?? []), { status: '已跟进', at: new Date().toISOString() }],
  })
}

export function setBoardNote(kind: BoardKind, id: number, note: string) {
  const trimmed = note.trim()
  patchMeta(kind, id, { note: trimmed || undefined })
}

export function toggleBoardPriority(kind: BoardKind, id: number) {
  patchMeta(kind, id, { priority: metaOf(kind)[id]?.priority ? undefined : true })
}

export function toggleBoardPinned(kind: BoardKind, id: number) {
  patchMeta(kind, id, { pinned: metaOf(kind)[id]?.pinned ? undefined : true })
}

export function useCampusFavorites(): CampusJob[] {
  return useSyncExternalStore(subscribe, () => campusFavorites)
}

export function useBianzhiFavorites(): BianzhiJob[] {
  return useSyncExternalStore(subscribe, () => bianzhiFavorites)
}

export function exportBoardData(kind: BoardKind): {
  favorites: (CampusJob | BianzhiJob)[]
  meta: Record<number, BoardMeta>
} {
  return kind === 'campus'
    ? { favorites: campusFavorites, meta: campusMeta }
    : { favorites: bianzhiFavorites, meta: bianzhiMeta }
}

/** 合并导入备份：同 id 以备份数据覆盖本地。返回合并后收藏总数。 */
export function mergeBoardData(
  kind: BoardKind,
  favs: (CampusJob | BianzhiJob)[],
  meta: Record<number, BoardMeta>,
): number {
  if (kind === 'campus') {
    const byId = new Map(campusFavorites.map((j) => [j.id, j]))
    for (const j of favs) byId.set(j.id, j as CampusJob)
    campusFavorites = [...byId.values()].slice(0, FAV_MAX)
    campusMeta = { ...campusMeta, ...meta }
    writeJson(FAV_KEYS.campus, campusFavorites)
    writeJson(META_KEYS.campus, campusMeta)
    emit()
    return campusFavorites.length
  }
  const byId = new Map(bianzhiFavorites.map((j) => [j.id, j]))
  for (const j of favs) byId.set(j.id, j as BianzhiJob)
  bianzhiFavorites = [...byId.values()].slice(0, FAV_MAX)
  bianzhiMeta = { ...bianzhiMeta, ...meta }
  writeJson(FAV_KEYS.bianzhi, bianzhiFavorites)
  writeJson(META_KEYS.bianzhi, bianzhiMeta)
  emit()
  return bianzhiFavorites.length
}

export function useCampusMeta(): Record<number, BoardMeta> {
  return useSyncExternalStore(subscribe, () => campusMeta)
}

export function useBianzhiMeta(): Record<number, BoardMeta> {
  return useSyncExternalStore(subscribe, () => bianzhiMeta)
}
