import { useEffect, useState } from 'react'
import { fetchDeadlines, type DeadlineEntry, type Position } from '@/api'
import { PositionSheet } from './PositionSheet'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlarmClock, ChevronDown, ChevronUp } from 'lucide-react'

const COLLAPSED_COUNT = 3

function daysLeftLabel(e: DeadlineEntry): string {
  if (e.daysLeft !== null) {
    if (e.daysLeft <= 0) return '今日截止'
    return `剩 ${e.daysLeft} 天`
  }
  const d = new Date(e.deadline)
  if (isNaN(d.getTime())) return e.deadline
  const diff = Math.ceil((d.getTime() - Date.now()) / 86400000)
  if (diff <= 0) return '今日截止'
  return `剩 ${diff} 天`
}

export function DeadlinesCard() {
  const [entries, setEntries] = useState<DeadlineEntry[]>([])
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<Position | null>(null)

  useEffect(() => {
    fetchDeadlines()
      .then(setEntries)
      .catch(() => setFailed(true))
  }, [])

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
              className="h-7 gap-1 text-xs text-muted-foreground"
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
            const row = (
              <div className="flex items-center gap-2 py-2 text-sm">
                <Badge variant="outline" className="shrink-0 border-amber-300 text-[11px] text-amber-700 dark:border-amber-800 dark:text-amber-400">
                  {daysLeftLabel(e)}
                </Badge>
                <span className="line-clamp-1 min-w-0 flex-1">
                  {e.title || '-'}
                  {e.employer && <span className="ml-2 text-xs text-muted-foreground">{e.employer}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{e.deadline}</span>
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
