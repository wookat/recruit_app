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

export function favoritesShareUrl(ids: number[]): string {
  return `${window.location.origin}${window.location.pathname}?favorites=${ids.join(',')}`
}
