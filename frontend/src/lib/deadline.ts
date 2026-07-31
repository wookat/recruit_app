import type { Position } from '@/api'

const FULL_DATE = /(?<!\d)(\d{4})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})\s*日?(?!\d)/g
const SHORT_DATE = /(?<!\d)(\d{1,2})\s*[月.\-/]\s*(\d{1,2})\s*日?(?!\d)/g

function makeDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month - 1, day)
  return d.getMonth() === month - 1 && d.getDate() === day ? d : null
}

/** 从任意日期文本中提取最后一个日期（无法解析返回 null）。 */
export function parseDeadlineText(
  raw: string | null | undefined,
  fallbackYear?: number,
): Date | null {
  const text = (raw || '').trim()
  if (!text) return null

  let last: Date | null = null
  for (const m of text.matchAll(FULL_DATE)) {
    const d = makeDate(Number(m[1]), Number(m[2]), Number(m[3]))
    if (d) last = d
  }
  if (last) return last

  const year = fallbackYear || new Date().getFullYear()
  for (const m of text.matchAll(SHORT_DATE)) {
    const d = makeDate(year, Number(m[1]), Number(m[2]))
    if (d) last = d
  }
  return last
}

/** 从报名时间原文中提取最后一个日期作为截止日期（无法解析返回 null）。 */
export function parseSignupDeadline(item: Position): Date | null {
  return parseDeadlineText(item.signup_time, item.year || undefined)
}

export function daysUntil(d: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function formatDayLabel(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 周${WEEKDAYS[d.getDay()]}`
}
