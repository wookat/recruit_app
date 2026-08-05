import { t, tt } from './i18n'
import type { BianzhiJob, CampusJob, Position } from '@/api'
import {
  exportPositionData,
  mergePositionData,
  type PositionBackup,
} from '@/lib/positionStore'
import {
  exportBoardData,
  mergeBoardData,
  type BoardMeta,
} from '@/lib/boardFavorites'

export const BACKUP_VERSION = 1

export interface BackupFile {
  app: 'recruit'
  version: number
  exportedAt: string
  positions: PositionBackup
  campus: { favorites: CampusJob[]; meta: Record<number, BoardMeta> }
  bianzhi: { favorites: BianzhiJob[]; meta: Record<number, BoardMeta> }
}

export function buildBackup(): BackupFile {
  const campus = exportBoardData('campus')
  const bianzhi = exportBoardData('bianzhi')
  return {
    app: 'recruit',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    positions: exportPositionData(),
    campus: { favorites: campus.favorites as CampusJob[], meta: campus.meta },
    bianzhi: { favorites: bianzhi.favorites as BianzhiJob[], meta: bianzhi.meta },
  }
}

export function downloadBackup() {
  const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = tt`上岸雷达收藏备份_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function itemsWithId<T extends { id: number }>(v: unknown): T[] {
  if (!Array.isArray(v)) return []
  return v.filter((it): it is T => isRecord(it) && typeof it.id === 'number')
}

function recordOf(v: unknown): Record<number, never> {
  return isRecord(v) ? (v as Record<number, never>) : {}
}

export interface RestoreResult {
  positions: number
  campus: number
  bianzhi: number
  added: number
  updated: number
}

/** 解析并合并导入备份 JSON。格式非法抛出 Error，不修改现有数据。 */
export function restoreBackup(text: string): RestoreResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(t('文件不是有效的 JSON'))
  }
  if (!isRecord(parsed) || parsed.app !== 'recruit' || typeof parsed.version !== 'number') {
    throw new Error(t('不是上岸雷达的收藏备份文件'))
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error(tt`备份版本 ${parsed.version} 过新，请更新页面后重试`)
  }
  const pos = isRecord(parsed.positions) ? parsed.positions : {}
  const campus = isRecord(parsed.campus) ? parsed.campus : {}
  const bianzhi = isRecord(parsed.bianzhi) ? parsed.bianzhi : {}

  const posStats = mergePositionData({
    favorites: itemsWithId<Position>(pos.favorites),
    statuses: recordOf(pos.statuses),
    notes: recordOf(pos.notes),
    channels: recordOf(pos.channels),
    priorities: recordOf(pos.priorities),
    statusHistory: isRecord(pos.statusHistory) ? (pos.statusHistory as PositionBackup['statusHistory']) : undefined,
    pinned: isRecord(pos.pinned) ? (pos.pinned as PositionBackup['pinned']) : undefined,
  })
  const campusStats = mergeBoardData(
    'campus',
    itemsWithId<CampusJob>(campus.favorites),
    recordOf(campus.meta),
  )
  const bianzhiStats = mergeBoardData(
    'bianzhi',
    itemsWithId<BianzhiJob>(bianzhi.favorites),
    recordOf(bianzhi.meta),
  )
  return {
    positions: posStats.total,
    campus: campusStats.total,
    bianzhi: bianzhiStats.total,
    added: posStats.added + campusStats.added + bianzhiStats.added,
    updated: posStats.updated + campusStats.updated + bianzhiStats.updated,
  }
}
