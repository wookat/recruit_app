import { useEffect, useState } from 'react'
import { fetchDeadlines, type DeadlineEntry, type Position } from '@/api'
import { PositionSheet } from './PositionSheet'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlarmClock, ChevronDown, ChevronUp } from 'lucide-react'

const COLLAPSED_COUNT = 3

function daysLeft(e: DeadlineEntry): number | null {
  if (e.daysLeft !== null) return e.daysLeft
  const d = new Date(e.deadline)
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

function daysLeftLabel(n: number | null, fallback: string): string {
  if (n === null) return fallback
  if (n <= 0) return '今日截止'
  return `剩 ${n} 天`
}

function shortDate(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function urgencyClass(n: number | null): string {
  if (n !== null && n <= 1)
    return 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-400'
  if (n !== null && n <= 3)
    return 'border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400'
  return 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400'
}

interface Props {
  days?: number
  limit?: number
  defaultExpanded?: boolean
}

export function DeadlinesCard({ days = 7, limit = 20, defaultExpanded = false }: Props) {
  const [entries, setEntries] = useState<DeadlineEntry[]>([])
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [selected, setSelected] = useState<Position | null>(null)

  useEffect(() => {
    fetchDeadlines(days, limit)
      .then(setEntries)
      .catch(() => setFailed(true))
  }, [days, limit])

  if (failed || entries.length === 0) return null

  const visible = expanded ? entries : entries.slice(0, COLLAPSED_COUNT)

  return (
    <Card className="border-amber-200 dark:border-amber-900/50">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlarmClock className="h-4 w-4 text-amber-500" />
            报名即将截止
            <Badge variant="secondary" className="font-normal">
              {entries.length} 条
            </Badge>
          </div>
          {entries.length > COLLAPSED_COUNT && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-h-11 gap-1 text-xs text-muted-foreground sm:h-7 sm:min-h-0"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <>
                  收起 <ChevronUp className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  展开 <ChevronDown className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          )}
        </div>
        <div className="divide-y">
          {visible.map((e, i) => {
            const n = daysLeft(e)
            const row = (
              <div className="flex min-h-11 items-center gap-2 py-2 text-sm sm:min-h-0">
                <Badge variant="outline" className={`shrink-0 text-[11px] ${urgencyClass(n)}`}>
                  {daysLeftLabel(n, e.deadline)}
                </Badge>
                <span className="line-clamp-1 min-w-0 flex-1">
                  {e.title || '-'}
                  {e.employer && <span className="ml-2 text-xs text-muted-foreground">{e.employer}</span>}
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline" title={e.deadline}>
                  {shortDate(e.deadline)}
                </span>
              </div>
            )
            return e.position ? (
              <button
                key={e.position.id}
                type="button"
                className="block w-full text-left hover:bg-muted/50"
                onClick={() => setSelected(e.position)}
              >
                {row}
              </button>
            ) : (
              <div key={`${e.title}-${i}`}>{row}</div>
            )
          })}
        </div>
      </CardContent>
      {selected && <PositionSheet item={selected} onClose={() => setSelected(null)} />}
    </Card>
  )
}
