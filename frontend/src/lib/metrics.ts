import { API_BASE } from '@/api'

const SID_KEY = 'recruit.sid'

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
