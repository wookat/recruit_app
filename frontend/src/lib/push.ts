import { t } from './i18n'
import { useSyncExternalStore } from 'react'
import axios from 'axios'
import { API_BASE, type BianzhiJob, type CampusJob, type Position } from '@/api'
import { getEffectiveDeadline, parseSignupDeadline } from '@/lib/deadline'
import { buildPushFilters } from '@/lib/savedNews'

const ENABLED_KEY = 'recruit.pushEnabled'
const EVENT = 'recruit-push-change'

export interface PushDueItem {
  /** 岗位标题（单位/公司名）。 */
  t: string
  /** 截止日期 YYYY-MM-DD。 */
  d: string
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 从三板块收藏构建推送用截止快照（只含有截止日期的条目）。 */
export function buildPushItems(
  favorites: Position[],
  campusFavorites: CampusJob[],
  bianzhiFavorites: BianzhiJob[],
): PushDueItem[] {
  const out: PushDueItem[] = []
  for (const p of favorites) {
    const d = parseSignupDeadline(p)
    if (d) out.push({ t: p.employer?.trim() || p.position_example?.trim() || p.job_type || t('体制内岗位'), d: fmtDate(d) })
  }
  for (const j of campusFavorites) {
    const d = getEffectiveDeadline(j)
    if (d) out.push({ t: j.company?.trim() || t('校招岗位'), d: fmtDate(d) })
  }
  for (const j of bianzhiFavorites) {
    const d = getEffectiveDeadline(j)
    if (d) out.push({ t: j.employer?.trim() || j.job_type || t('编制岗位'), d: fmtDate(d) })
  }
  return out
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function getPushEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

function setPushEnabledFlag(v: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, v ? '1' : '0')
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribeStore(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

export function usePushEnabled(): boolean {
  return useSyncExternalStore(subscribeStore, getPushEnabled)
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** 取 VAPID 公钥，瞬时网络抖动（status=0）自动重试一次。 */
async function fetchVapidKey(): Promise<string> {
  try {
    const res = await axios.get(`${API_BASE}/api/push/vapid-key`)
    return res.data.key
  } catch {
    await new Promise((r) => setTimeout(r, 800))
    const res = await axios.get(`${API_BASE}/api/push/vapid-key`)
    return res.data.key
  }
}

async function getSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

function subToBody(sub: PushSubscription, remindDays: number, items: PushDueItem[]) {
  const json = sub.toJSON()
  return {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    remind_days: remindDays,
    items,
    filters: buildPushFilters(),
  }
}

/**
 * 开启推送：请求通知权限 → 订阅 PushManager → 上报订阅与收藏截止快照。
 * 返回 'granted' | 'denied' | 'unsupported' | 'unconfigured' | 'error'。
 */
export async function enablePush(
  remindDays: number,
  items: PushDueItem[],
): Promise<'granted' | 'denied' | 'unsupported' | 'unconfigured' | 'error'> {
  if (!isPushSupported()) return 'unsupported'
  let perm = Notification.permission
  if (perm === 'default') {
    try {
      perm = await Notification.requestPermission()
    } catch {
      perm = 'denied'
    }
  }
  if (perm !== 'granted') return 'denied'
  let key: string
  try {
    key = await fetchVapidKey()
  } catch {
    return 'unconfigured'
  }
  if (!key) return 'unconfigured'
  try {
    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      }))
    await axios.post(`${API_BASE}/api/push/subscribe`, subToBody(sub, remindDays, items))
    setPushEnabledFlag(true)
    return 'granted'
  } catch {
    return 'error'
  }
}

/** 关闭推送：注销 PushManager 订阅并删除服务端记录。 */
export async function disablePush(): Promise<void> {
  setPushEnabledFlag(false)
  if (!isPushSupported()) return
  try {
    const sub = await getSubscription()
    if (sub) {
      await axios.post(`${API_BASE}/api/push/unsubscribe`, { endpoint: sub.endpoint }).catch(() => {})
      await sub.unsubscribe()
    }
  } catch {
    // ignore
  }
}

/** 已开启推送时同步最新收藏截止快照到服务端（收藏变化后调用）。
 * 本地标记已开启但浏览器订阅丢失（SW 更新/浏览器清理）且权限仍授予时，静默重建订阅。 */
export async function syncPushItems(remindDays: number, items: PushDueItem[]): Promise<void> {
  if (!getPushEnabled() || !isPushSupported()) return
  try {
    const sub = await getSubscription()
    if (!sub) {
      if (Notification.permission === 'granted') await enablePush(remindDays, items)
      return
    }
    await axios.post(`${API_BASE}/api/push/subscribe`, subToBody(sub, remindDays, items))
  } catch {
    // ignore
  }
}
