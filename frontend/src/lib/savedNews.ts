import { useSyncExternalStore } from 'react'
import {
  fetchBianzhiJobs,
  fetchCampusJobs,
  fetchPositions,
  type BianzhiParams,
  type CampusParams,
} from '@/api'
import { getSavedFilters, getSavedQueries } from './storage'

/** 常用筛选「订阅上新」：记录每组筛选上次查看时的结果总数基线，
 *  打开站点后台逐组静默请求当前总数（page_size=1，并发 ≤2），
 *  新增 >0 时提供 +N 徽章计数；点击恢复即 markSeen 更新基线。 */

const BASE_KEY = 'recruit.savedFilterBaselines'

interface Baseline {
  total: number
  at: number
}

type BaselineMap = Record<string, Baseline>

function readBaselines(): BaselineMap {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BASE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? (parsed as BaselineMap) : {}
  } catch {
    return {}
  }
}

function writeBaselines(map: BaselineMap) {
  try {
    localStorage.setItem(BASE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota / privacy-mode errors
  }
}

const bkey = (scope: string, name: string) => `${scope}|${name}`

// ---------- 模块级状态（useSyncExternalStore） ----------

interface NewsState {
  /** `${scope}|${name}` -> 新增条数 */
  counts: Record<string, number>
  /** 全站汇总新增条数 */
  sum: number
}

let state: NewsState = { counts: {}, sum: 0 }
/** 最近一次后台刷新拿到的当前总数（markSeen 用）。 */
const latestTotals: Record<string, number> = {}
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

function setCounts(counts: Record<string, number>) {
  state = { counts, sum: Object.values(counts).reduce((a, b) => a + b, 0) }
  notify()
}

export function useSavedNews(): NewsState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

/** 点击恢复某组筛选后视为已查看：基线更新为最近一次拿到的总数。 */
export function markSavedFilterSeen(scope: string, name: string) {
  const key = bkey(scope, name)
  const total = latestTotals[key]
  if (total !== undefined) {
    const map = readBaselines()
    map[key] = { total, at: Date.now() }
    writeBaselines(map)
  }
  if (state.counts[key]) {
    const next = { ...state.counts }
    delete next[key]
    setCounts(next)
  }
}

/** 删除某组已保存筛选时同步清理其基线，避免孤儿键。 */
export function removeSavedFilterBaseline(scope: string, name: string) {
  const key = bkey(scope, name)
  const map = readBaselines()
  if (key in map) {
    delete map[key]
    writeBaselines(map)
  }
  delete latestTotals[key]
  if (state.counts[key]) {
    const next = { ...state.counts }
    delete next[key]
    setCounts(next)
  }
}

// ---------- 快照 -> 列表 API 参数（保持原快照语义，不额外附加参数） ----------

function daysAgoStr(days: number): string {
  const d = new Date(Date.now() - days * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 与 CampusPage PRESETS 对应的 API 参数（仅计数用）。 */
const CAMPUS_PRESET_PARAMS: Record<string, Partial<CampusParams>> = {
  main: { source_table: ['校招汇总表'] },
  noexam: { source_table: ['免笔试汇总'] },
  referral: { referral_only: true },
  soe: { source_table: ['央国企事业单位名录'] },
  soecampus: { source_table: ['央国企校招'] },
  old: { source_table: ['24-25届可投'] },
  autumn: { batch: '秋招' },
  spring: { batch: '春招' },
  intern: { batch: '实习' },
  y27autumn: { batch: '秋招', grad_year: '2027' },
  internet: { industry: ['互联网'] },
  finance: { industry: ['银行', '金融'] },
  soe2: { company_type: ['央国企', '国企'] },
  foreign: { company_type: ['外企', '外企/合资', '合资', '中外合资'] },
}

/** 与 BianzhiPage PRESETS 对应的分类。 */
const BIANZHI_PRESET_CATEGORY: Record<string, string> = {
  gwy: '公务员事业单位',
  edu: '教育系统',
  med: '医疗系统',
  univ: '高校高职大专',
  sci: '科研院所',
  soe: '央国企社招',
  lk: '大型联考',
}

function campusQueryToParams(query: string): CampusParams {
  const q = new URLSearchParams(query)
  const preset = q.get('bpreset')
  const p: CampusParams = { ...(preset ? CAMPUS_PRESET_PARAMS[preset] : undefined) }
  if (preset === 'recent7') p.updated_after = daysAgoStr(7)
  const ctype = q.get('ctype')
  if (ctype) p.company_type = ctype.split(',')
  const city = q.get('city')
  if (city) p.location = city
  const cedu = q.get('cedu')
  if (cedu) p.edu = cedu
  const kw = q.get('bkw')
  if (kw) p.keyword = kw
  if (q.get('due')) p.due_within_days = 7
  if (q.get('hexp') === '1') p.hide_expired = true
  return p
}

function bianzhiQueryToParams(query: string): BianzhiParams {
  const q = new URLSearchParams(query)
  const preset = q.get('bpreset')
  const p: BianzhiParams = {}
  if (preset === 'recent7') p.updated_after = daysAgoStr(7)
  else if (preset && BIANZHI_PRESET_CATEGORY[preset]) p.category = [BIANZHI_PRESET_CATEGORY[preset]]
  const prov = q.get('prov')
  if (prov) p.province = prov.split(',')
  const bcity = q.get('bcity')
  if (bcity) p.city = bcity
  const bedu = q.get('bedu')
  if (bedu) p.edu = bedu
  const kw = q.get('bkw')
  if (kw) p.keyword = kw
  if (q.get('due')) p.due_within_days = 7
  if (q.get('hexp') === '1') p.hide_expired = true
  return p
}

// ---------- 上新浏览器通知（独立开关，默认关） ----------

const NEWS_NOTIFY_KEY = 'recruit.newsNotifyEnabled'
const NEWS_LAST_DATE_KEY = 'recruit.lastNewsNotifiedDate'
const NEWS_NOTIFY_EVENT = 'recruit-news-notify-change'

export function getNewsNotifyEnabled(): boolean {
  try {
    return localStorage.getItem(NEWS_NOTIFY_KEY) === '1'
  } catch {
    return false
  }
}

export function setNewsNotifyEnabled(v: boolean) {
  try {
    localStorage.setItem(NEWS_NOTIFY_KEY, v ? '1' : '0')
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(NEWS_NOTIFY_EVENT))
}

function subscribeNewsNotify(cb: () => void) {
  window.addEventListener(NEWS_NOTIFY_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(NEWS_NOTIFY_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

export function useNewsNotifyEnabled(): boolean {
  return useSyncExternalStore(subscribeNewsNotify, getNewsNotifyEnabled)
}

/** 开启上新通知：请求权限，被拒返回 'denied'（调用方提示并回退站内红点）。 */
export async function enableNewsNotification(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  let perm = Notification.permission
  if (perm === 'default') {
    try {
      perm = await Notification.requestPermission()
    } catch {
      perm = 'denied'
    }
  }
  setNewsNotifyEnabled(perm === 'granted')
  return perm
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 刷新完成后调用：开关开且已授权、当日未发过、有上新时发一条聚合通知，点击进站打开订阅面板。 */
export function maybeNotifySavedNews(onOpen: () => void) {
  const filterCount = Object.keys(state.counts).length
  if (state.sum <= 0 || filterCount === 0 || !getNewsNotifyEnabled()) return
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    if (localStorage.getItem(NEWS_LAST_DATE_KEY) === todayStr()) return
    localStorage.setItem(NEWS_LAST_DATE_KEY, todayStr())
  } catch {
    return
  }
  const n = new Notification('上岸罗盘 · 订阅上新', {
    body: `你订阅的 ${filterCount} 个筛选共新增 ${state.sum} 条，点击查看`,
    tag: 'recruit-news-daily',
    icon: '/favicon.svg',
  })
  n.onclick = () => {
    window.focus()
    onOpen()
    n.close()
  }
}

// ---------- 订阅面板（全局挂载，速览胶囊/通知点击打开） ----------

let panelOpen = false
const panelListeners = new Set<() => void>()

export function openSubscriptionsPanel() {
  panelOpen = true
  for (const l of panelListeners) l()
}

export function closeSubscriptionsPanel() {
  panelOpen = false
  for (const l of panelListeners) l()
}

export function useSubscriptionsPanelOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      panelListeners.add(cb)
      return () => panelListeners.delete(cb)
    },
    () => panelOpen,
  )
}

// ---------- 后台静默刷新 ----------

let refreshed = false

/** 打开站点时调用一次：逐组静默请求当前总数（并发 ≤2），失败静默跳过。 */
export function refreshSavedNews(onDone?: () => void) {
  if (refreshed) return
  refreshed = true

  const jobs: { key: string; fetchTotal: () => Promise<number> }[] = [
    ...getSavedFilters().map((f) => ({
      key: bkey('positions', f.name),
      fetchTotal: () =>
        fetchPositions({ ...f.params, page: 1, page_size: 1 }).then((r) => r.total),
    })),
    ...getSavedQueries('campus').map((f) => ({
      key: bkey('campus', f.name),
      fetchTotal: () =>
        fetchCampusJobs({ ...campusQueryToParams(f.query), page: 1, page_size: 1 }).then(
          (r) => r.total,
        ),
    })),
    ...getSavedQueries('bianzhi').map((f) => ({
      key: bkey('bianzhi', f.name),
      fetchTotal: () =>
        fetchBianzhiJobs({ ...bianzhiQueryToParams(f.query), page: 1, page_size: 1 }).then(
          (r) => r.total,
        ),
    })),
  ]
  if (jobs.length === 0) {
    onDone?.()
    return
  }

  const validKeys = new Set(jobs.map((j) => j.key))
  const counts: Record<string, number> = {}
  let idx = 0

  const worker = async () => {
    while (idx < jobs.length) {
      const job = jobs[idx]
      idx += 1
      try {
        const total = await job.fetchTotal()
        latestTotals[job.key] = total
        const map = readBaselines()
        const base = map[job.key]
        if (base === undefined) {
          // 首次记录基线：不算新增
          map[job.key] = { total, at: Date.now() }
          writeBaselines(map)
        } else if (total > base.total) {
          counts[job.key] = total - base.total
          setCounts({ ...counts })
        }
      } catch {
        // 失败静默跳过
      }
    }
  }

  void Promise.all([worker(), worker()]).then(() => {
    // 清理已删除筛选的基线
    const map = readBaselines()
    let dirty = false
    for (const key of Object.keys(map)) {
      if (!validKeys.has(key)) {
        delete map[key]
        dirty = true
      }
    }
    if (dirty) writeBaselines(map)
    setCounts({ ...counts })
    onDone?.()
  })
}
