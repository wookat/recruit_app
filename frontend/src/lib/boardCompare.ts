import { useSyncExternalStore } from 'react'
import type { BianzhiJob, CampusJob } from '@/api'

export const BOARD_COMPARE_MAX = 3

export type BoardCompareBoard = 'campus' | 'bianzhi'

export type BoardCompareItem =
  | { board: 'campus'; job: CampusJob }
  | { board: 'bianzhi'; job: BianzhiJob }

let items: BoardCompareItem[] = []
let hint: string | null = null

type Listener = () => void
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(l: Listener) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function isBoardCompared(board: BoardCompareBoard, id: number): boolean {
  return items.some((s) => s.board === board && s.job.id === id)
}

/** 加入/移出对比（行数据快照，不要求已收藏）。同板块限制、最多 3 条。 */
export function toggleBoardCompare(item: BoardCompareItem) {
  if (isBoardCompared(item.board, item.job.id)) {
    items = items.filter((s) => !(s.board === item.board && s.job.id === item.job.id))
    hint = null
    emit()
    return
  }
  if (items.length > 0 && items[0].board !== item.board) {
    hint = '仅支持同板块岗位对比，请先清空已选'
    emit()
    return
  }
  if (items.length >= BOARD_COMPARE_MAX) {
    hint = `最多同时对比 ${BOARD_COMPARE_MAX} 条`
    emit()
    return
  }
  items = [...items, item]
  hint = null
  emit()
}

export function removeBoardCompare(board: BoardCompareBoard, id: number) {
  items = items.filter((s) => !(s.board === board && s.job.id === id))
  hint = null
  emit()
}

export function clearBoardCompare() {
  items = []
  hint = null
  emit()
}

export function useBoardCompare(): BoardCompareItem[] {
  return useSyncExternalStore(subscribe, () => items)
}

export function useBoardCompareHint(): string | null {
  return useSyncExternalStore(subscribe, () => hint)
}
