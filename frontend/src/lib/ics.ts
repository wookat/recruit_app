/** 纯前端手写 ICS 生成（无依赖）。 */

export interface IcsEvent {
  /** 稳定 UID（同一收藏多次导出保持一致）。 */
  uid: string
  /** 全天事件日期。 */
  date: Date
  summary: string
  description?: string
}

/** ICS 文本转义：反斜杠、分号、逗号、换行。 */
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** 超过 75 字节按 RFC 5545 折行（续行以空格开头）。 */
function foldLine(line: string): string[] {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return [line]
  const out: string[] = []
  let cur = ''
  let curLen = 0
  for (const ch of line) {
    const chLen = new TextEncoder().encode(ch).length
    const limit = out.length === 0 ? 75 : 74
    if (curLen + chLen > limit) {
      out.push(out.length === 0 ? cur : ` ${cur}`)
      cur = ch
      curLen = chLen
    } else {
      cur += ch
      curLen += chLen
    }
  }
  if (cur) out.push(out.length === 0 ? cur : ` ${cur}`)
  return out
}

export function buildIcs(events: IcsEvent[]): string {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//zalize//shangan-luopan//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  for (const ev of events) {
    const next = new Date(ev.date)
    next.setDate(next.getDate() + 1)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${fmtDate(ev.date)}`,
      `DTEND;VALUE=DATE:${fmtDate(next)}`,
      `SUMMARY:${escapeText(ev.summary)}`,
    )
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.flatMap(foldLine).join('\r\n') + '\r\n'
}

export function downloadIcs(events: IcsEvent[], filename: string) {
  const blob = new Blob([buildIcs(events)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
