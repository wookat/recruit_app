import { CalendarClock } from 'lucide-react'
import { daysUntil } from '@/lib/deadline'
import { cn } from '@/lib/utils'

function fmt(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 网申窗口时间线：开始→截止进度条 + 今天位置与状态（未开始/进行中/已截止）。 */
export function ApplyTimeline({ start, end }: { start: Date; end: Date }) {
  const total = Math.max(1, daysUntil(end) - daysUntil(start))
  const toStart = daysUntil(start)
  const toEnd = daysUntil(end)

  let status: string
  let statusClass: string
  let pct: number
  if (toStart > 0) {
    status = `未开始 · ${toStart} 天后开放`
    statusClass = 'text-muted-foreground'
    pct = 0
  } else if (toEnd < 0) {
    status = '网申已截止'
    statusClass = 'text-muted-foreground'
    pct = 100
  } else {
    status = toEnd === 0 ? '网申进行中 · 今天截止' : `网申进行中 · 剩 ${toEnd} 天`
    statusClass = toEnd <= 3 ? 'text-red-600 dark:text-red-400' : 'text-primary'
    pct = Math.round(((total - toEnd) / total) * 100)
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
        <span className="flex items-center gap-1 font-medium text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          网申时间线
        </span>
        <span className={cn('font-medium', statusClass)}>{status}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="网申进度">
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            toEnd < 0 ? 'bg-muted-foreground/40' : toEnd <= 3 ? 'bg-red-500' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>开始 {fmt(start)}</span>
        <span>截止 {fmt(end)}</span>
      </div>
    </div>
  )
}
