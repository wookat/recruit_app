import { t, tt } from './i18n'
import { useSyncExternalStore } from 'react'
import { isWeChat } from './wechat'

const ENABLED_KEY = 'recruit.dueNotifyEnabled'
const LAST_DATE_KEY = 'recruit.lastNotifiedDate'
const EVENT = 'recruit-due-notify-change'

export function isNotificationSupported(): boolean {
  // 微信内置浏览器可能暴露 Notification 但权限/展示不可用，统一视为不支持
  return typeof window !== 'undefined' && !isWeChat() && 'Notification' in window
}

export function getNotifyEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

export function setNotifyEnabled(v: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, v ? '1' : '0')
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

export function useNotifyEnabled(): boolean {
  return useSyncExternalStore(subscribe, getNotifyEnabled)
}

/** 开启通知：请求权限，被拒返回 'denied'（调用方提示并回退站内红点）。 */
export async function enableDueNotification(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied'
  let perm = Notification.permission
  if (perm === 'default') {
    try {
      perm = await Notification.requestPermission()
    } catch {
      perm = 'denied'
    }
  }
  setNotifyEnabled(perm === 'granted')
  return perm
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 打开站点时的截止聚合提醒：开关开启且已授权、当日未发过、存在 ≤remindDays 天
 * 截止的收藏时发一条本地聚合通知，点击聚焦站点并打开收藏面板。每日至多一条。
 */
export function maybeNotifyDue(count: number, remindDays: number, onOpenFavorites: () => void) {
  if (count <= 0 || !getNotifyEnabled()) return
  if (!isNotificationSupported() || Notification.permission !== 'granted') return
  try {
    if (localStorage.getItem(LAST_DATE_KEY) === todayStr()) return
    localStorage.setItem(LAST_DATE_KEY, todayStr())
  } catch {
    return
  }
  const n = new Notification(t('上岸雷达 · 截止提醒'), {
    body: tt`你有 ${count} 条收藏岗位将在 ${remindDays} 天内截止报名，点击查看`,
    tag: 'recruit-due-daily',
    icon: '/favicon.svg',
  })
  n.onclick = () => {
    window.focus()
    onOpenFavorites()
    n.close()
  }
}
