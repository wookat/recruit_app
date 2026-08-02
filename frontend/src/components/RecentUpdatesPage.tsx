import { useEffect, useState } from 'react'
import { BriefcaseBusiness, ChevronRight, Landmark, Sparkles } from 'lucide-react'
import {
  fetchRecentUpdates,
  type RecentUpdateBoard,
  type RecentUpdateDay,
} from '@/api'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { FreshnessNote } from '@/components/FreshnessNote'

type Board = 'positions' | 'campus' | 'bianzhi'

const BOARD_META: Record<Board, { label: string; icon: typeof Sparkles }> = {
  positions: { label: '体制内', icon: Landmark },
  campus: { label: '校招', icon: BriefcaseBusiness },
  bianzhi: { label: '编制', icon: Sparkles },
}

const BOARD_ORDER: Board[] = ['positions', 'campus', 'bianzhi']

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (isNaN(d.getTime())) return iso
  const today = new Date()
  const days = Math.floor(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000,
  )
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  const base = `${d.getMonth() + 1} 月 ${d.getDate()} 日（周${week}）`
  if (days === 0) return `今天 · ${base}`
  if (days === 1) return `昨天 · ${base}`
  return base
}

interface Props {
  onOpenJob: (board: Board, id: number) => void
  onOpenBoard: (board: Board) => void
}

export function RecentUpdatesPage({ onOpenJob, onOpenBoard }: Props) {
  const [days, setDays] = useState<RecentUpdateDay[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [boardFilter, setBoardFilter] = useState<Board | 'all'>(() => {
    const v = new URLSearchParams(window.location.search).get('ub')
    return v === 'positions' || v === 'campus' || v === 'bianzhi' ? v : 'all'
  })

  const selectBoard = (v: Board | 'all') => {
    setBoardFilter(v)
    const q = new URLSearchParams(window.location.search)
    if (v === 'all') q.delete('ub')
    else q.set('ub', v)
    window.history.replaceState(null, '', `?${q.toString()}${window.location.hash}`)
  }

  const visibleBoards: Board[] = boardFilter === 'all' ? BOARD_ORDER : [boardFilter]
  const visibleDays = (days ?? []).filter((day) =>
    visibleBoards.some((b) => (day.boards[b]?.count ?? 0) > 0),
  )

  useEffect(() => {
    let cancelled = false
    fetchRecentUpdates(7)
      .then((r) => {
        if (!cancelled) setDays(r.days)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">近 7 天更新</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            三板块新增岗位按日聚合，每日 6:20 自动同步入库
          </p>
        </div>
        <FreshnessNote board="positions" />
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="按板块过滤">
        {(['all', ...BOARD_ORDER] as const).map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={boardFilter === b}
            onClick={() => selectBoard(b)}
            className={cn(
              'min-h-11 rounded-full border px-3 py-1 text-xs transition-colors sm:min-h-0',
              boardFilter === b
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
          >
            {b === 'all' ? '全部' : BOARD_META[b].label}
          </button>
        ))}
      </div>

      {days === null && !failed && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      )}
      {failed && <EmptyState title="加载失败" description="请稍后刷新重试" />}
      {days !== null && visibleDays.length === 0 && (
        <EmptyState
          title={boardFilter === 'all' ? '近 7 天暂无新增' : `${BOARD_META[boardFilter].label}近 7 天暂无新增`}
          description="数据每日自动同步，欢迎明天再来看看"
        />
      )}

      {visibleDays.map((day) => (
        <section key={day.date} className="rounded-xl border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">{fmtDate(day.date)}</h3>
          <div className="space-y-3">
            {visibleBoards.map((board) => {
              const b: RecentUpdateBoard | undefined = day.boards[board]
              if (!b || b.count === 0) return null
              const meta = BOARD_META[board]
              const Icon = meta.icon
              return (
                <div key={board}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <Badge variant="secondary" className="gap-1 px-1.5 text-[11px]">
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      新增 {b.count.toLocaleString()} 条
                      {b.bulk && ' · 数据全量同步日，不逐条展示'}
                    </span>
                  </div>
                  {b.items.length > 0 && (
                    <ul className="divide-y rounded-lg border">
                      {b.items.map((it) => (
                        <li key={`${board}-${it.id}`}>
                          <button
                            type="button"
                            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                            onClick={() => onOpenJob(board, it.id)}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              <span className="font-medium">{it.title || '—'}</span>
                              {it.sub && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {it.sub.length > 40 ? `${it.sub.slice(0, 40)}…` : it.sub}
                                </span>
                              )}
                            </span>
                            {it.extra && (
                              <Badge variant="outline" className="shrink-0 px-1.5 text-[10px]">
                                {it.extra}
                              </Badge>
                            )}
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {b.count > b.items.length && !b.bulk && (
                    <button
                      type="button"
                      className="mt-1.5 inline-flex min-h-11 items-center gap-1 text-xs text-primary underline-offset-4 hover:underline sm:min-h-0"
                      onClick={() => onOpenBoard(board)}
                    >
                      查看{meta.label}板块全部
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
