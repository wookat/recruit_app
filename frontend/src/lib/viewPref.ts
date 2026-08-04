/** 列表视图偏好（表格/卡片）按板块记忆：用户手动切换后持久化，
 *  刷新/下次访问沿用；未设置过时按屏宽默认（<768px 用卡片）。 */

const KEY_PREFIX = 'recruit.viewPref.'

export type ListView = 'table' | 'card'

export function getViewPref(board: 'campus' | 'bianzhi'): ListView {
  try {
    const v = localStorage.getItem(KEY_PREFIX + board)
    if (v === 'table' || v === 'card') return v
  } catch {
    // ignore
  }
  return typeof window !== 'undefined' && window.innerWidth < 768 ? 'card' : 'table'
}

export function setViewPref(board: 'campus' | 'bianzhi', v: ListView) {
  try {
    localStorage.setItem(KEY_PREFIX + board, v)
  } catch {
    // ignore
  }
}
