import type { Position } from '@/api'

const FULL_DATE = /(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/g
const SHORT_DATE = /(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g

/** 从报名时间原文中提取最后一个日期作为截止日期（无法解析返回 null）。 */
export function parseSignupDeadline(item: Position): Date | null {
  const raw = (item.signup_time || '').trim()
  if (!raw) return null

  let last: Date | null = null
  for (const m of raw.matchAll(FULL_DATE)) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    if (!isNaN(d.getTime())) last = d
  }
  if (last) return last

  const year = item.year || new Date().getFullYear()
  for (const m of raw.matchAll(SHORT_DATE)) {
    const d = new Date(year, Number(m[1]) - 1, Number(m[2]))
    if (!isNaN(d.getTime())) last = d
  }
  return last
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
