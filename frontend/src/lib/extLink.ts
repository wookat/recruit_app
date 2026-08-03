import { useSyncExternalStore } from 'react'

/** 「外链打开前确认」偏好（默认关：直接跳转）。 */
const KEY = 'recruit.confirmExtLink'

const listeners = new Set<() => void>()

export function isConfirmExtLink(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setConfirmExtLink(v: boolean) {
  try {
    if (v) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

export function useConfirmExtLink(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    isConfirmExtLink,
  )
}

/** 提取链接域名（如 mp.weixin.qq.com），非法 URL 返回空串。 */
export function domainOf(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
