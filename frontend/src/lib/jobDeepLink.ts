const PARAM = 'job'

/** 打开详情时把 job=board:id 写入 URL（replaceState，不换路由）。 */
export function setJobParam(key: string) {
  const q = new URLSearchParams(window.location.search)
  q.set(PARAM, key)
  window.history.replaceState(null, '', `?${q.toString()}${window.location.hash}`)
}

/** 关闭详情时清除 job 参数（仅当仍指向自己时）。 */
export function clearJobParam(key: string) {
  const q = new URLSearchParams(window.location.search)
  if (q.get(PARAM) !== key) return
  q.delete(PARAM)
  const s = q.toString()
  window.history.replaceState(null, '', `${s ? `?${s}` : window.location.pathname}${window.location.hash}`)
}

/** 读取 URL 中的 job 深链（如 bianzhi:123）；非法则返回 null。 */
export function readJobParam(board: string): number | null {
  const v = new URLSearchParams(window.location.search).get(PARAM)
  if (!v) return null
  const [b, idStr] = v.split(':')
  const id = Number(idStr)
  return b === board && Number.isInteger(id) && id > 0 ? id : null
}
