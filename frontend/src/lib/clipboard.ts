export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

export function positionShareUrl(id: number): string {
  return `${window.location.origin}${window.location.pathname}?position_id=${id}`
}

/** 岗位详情深链（?job=board:id），后端对该链接注入分享卡片 meta。 */
export function jobShareUrl(board: 'positions' | 'campus' | 'bianzhi', id: number): string {
  const base = `${window.location.origin}${window.location.pathname}`
  if (board === 'positions') return `${base}?job=positions:${id}`
  const preset = board === 'bianzhi' ? '&bpreset=all' : ''
  return `${base}?board=${board}${preset}&job=${board}:${id}`
}

export function favoritesShareUrl(ids: number[]): string {
  return `${window.location.origin}${window.location.pathname}?favorites=${ids.join(',')}`
}
