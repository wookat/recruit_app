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

/** 官方来源域名后缀（政府/军队/教育/全国性官方就业平台）。 */
const OFFICIAL_SUFFIXES = ['.gov.cn', '.edu.cn', '.81.cn', '.mil.cn']
const OFFICIAL_HOSTS = ['gov.cn', '81.cn', 'ncss.cn', 'job.ncss.cn', 'www.iguopin.com', 'iguopin.com']

export type SourceTrust = 'official' | 'third-party' | ''

/** 判断链接来源可信级别：官方（政府/军队/教育/国家平台）或第三方聚合站。 */
export function sourceTrust(url: string | null | undefined): SourceTrust {
  const host = domainOf(url)
  if (!host) return ''
  if (OFFICIAL_HOSTS.includes(host) || OFFICIAL_SUFFIXES.some((s) => host.endsWith(s))) {
    return 'official'
  }
  return 'third-party'
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
