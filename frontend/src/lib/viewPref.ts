/** 列表视图偏好（表格/卡片等）按板块记忆：用户手动切换后持久化，
 *  刷新/下次访问沿用；未设置过时由调用方按屏宽给默认。
 *  窄屏（<768px）下表格视图可读性差，初始加载忽略保存的 table 偏好
 *  强制卡片，会话内仍可手动切回表格。 */

import { useEffect } from 'react'

export function isNarrowScreen(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
}

/** 视口收窄到 <768px 时回调（旋转/缩放窗口场景），供列表页把表格视图降级为卡片。 */
export function useOnNarrowScreen(onNarrow: () => void) {
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) onNarrow()
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [onNarrow])
}

const KEY_PREFIX = 'recruit.viewPref.'

export type ListView = 'table' | 'card'

export function readViewPref<T extends string>(
  board: 'positions' | 'campus' | 'bianzhi',
  allowed: readonly T[],
): T | null {
  try {
    const v = localStorage.getItem(KEY_PREFIX + board)
    if (v && (allowed as readonly string[]).includes(v)) return v as T
  } catch {
    // ignore
  }
  return null
}

export function getViewPref(board: 'campus' | 'bianzhi'): ListView {
  if (isNarrowScreen()) return 'card'
  return readViewPref(board, ['table', 'card'] as const) ?? 'table'
}

export function setViewPref(board: 'positions' | 'campus' | 'bianzhi', v: string) {
  try {
    localStorage.setItem(KEY_PREFIX + board, v)
  } catch {
    // ignore
  }
}
