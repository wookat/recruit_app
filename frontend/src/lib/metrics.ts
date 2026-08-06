import { API_BASE } from '@/api'

const SID_KEY = 'recruit.sid'
const INTERNAL_KEY = 'recruit.internal'

/** 内部走查/测试流量不计入 PV：带 ?qa=1 访问一次后本机永久排除 */
function isInternal(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('qa') === '1') {
      localStorage.setItem(INTERNAL_KEY, '1')
      return true
    }
    return localStorage.getItem(INTERNAL_KEY) === '1'
  } catch {
    return false
  }
}

function getSid(): string {
  try {
    let sid = sessionStorage.getItem(SID_KEY)
    if (!sid) {
      sid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
      sessionStorage.setItem(SID_KEY, sid)
    }
    return sid
  } catch {
    return ''
  }
}

let lastKey = ''
let lastAt = 0

/** 自建轻量访问统计上报（无 cookie、无个人数据，失败静默）。 */
export function reportPv(board: string, page = '') {
  if (isInternal()) return
  const key = `${board}|${page}`
  const now = Date.now()
  if (key === lastKey && now - lastAt < 2000) return // 去重：rerender/StrictMode 双触发
  lastKey = key
  lastAt = now
  try {
    void fetch(`${API_BASE}/api/metrics/pv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board, page, sid: getSid() }),
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // ignore
  }
}

let lastJobKey = ''
let lastJobAt = 0

/** 岗位级浏览上报：详情面板打开时计数（QA/内部流量同样排除，失败静默）。 */
export function reportJobView(board: string, jobId: number) {
  if (isInternal()) return
  const key = `${board}|${jobId}`
  const now = Date.now()
  if (key === lastJobKey && now - lastJobAt < 2000) return // 去重：rerender/StrictMode 双触发
  lastJobKey = key
  lastJobAt = now
  try {
    void fetch(`${API_BASE}/api/metrics/job-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board, job_id: jobId }),
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // ignore
  }
}

export type MetricEvent =
  | 'remind_set'
  | 'save_filter'
  | 'new_since_click'
  | 'apply_click'
  | 'apply_marked'

/** 留存功能埋点事件（复用 metrics_pv 通道，board="event"）。 */
export function reportEvent(event: MetricEvent) {
  if (isInternal()) return
  try {
    void fetch(`${API_BASE}/api/metrics/pv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: 'event', page: event, sid: getSid() }),
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // ignore
  }
}
