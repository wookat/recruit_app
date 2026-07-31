import { useMemo, useState } from 'react'
import type { Position } from '@/api'
import { daysUntil, formatDayLabel, parseSignupDeadline } from '@/lib/deadline'
import {
  APP_STATUSES,
  STATUS_COLORS,
  clearFavorites,
  setAppChannel,
  setAppNote,
  setAppStatus,
  toggleFavorite,
  useAppChannels,
  useAppNotes,
  useAppStatuses,
  useFavorites,
  type AppStatus,
} from '@/lib/positionStore'
import { APP_CHANNELS, channelClass, PILL_BASE, type AppChannel } from '@/lib/badgeColors'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { copyText, favoritesShareUrl } from '@/lib/clipboard'
import { PositionSheet } from './PositionSheet'
import { CompareButton } from './CompareButton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Building2, MapPin, Star, Trash2, Link2, Check, CalendarDays, ListChecks, StickyNote } from 'lucide-react'
import { EmptyState } from './EmptyState'

interface Props {
  open: boolean
  onClose: () => void
}

export function FavoritesSheet({ open, onClose }: Props) {
  const favorites = useFavorites()
  const statuses = useAppStatuses()
  const notes = useAppNotes()
  const channels = useAppChannels()
  const [selected, setSelected] = useState<Position | null>(null)
  const [noteEditing, setNoteEditing] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [view, setView] = useState<'track' | 'calendar'>('track')
  const [statusFilter, setStatusFilter] = useState<AppStatus | null>(null)

  const statusCounts = favorites.reduce<Record<string, number>>((acc, p) => {
    const s = statuses[p.id] || '未投递'
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})

  const groups = APP_STATUSES.map((s) => ({
    status: s,
    items: favorites.filter((p) => (statuses[p.id] || '未投递') === s),
  })).filter((g) => g.items.length > 0 && (!statusFilter || g.status === statusFilter))

  const calendarDays = useMemo(() => {
    const byDay = new Map<string, { date: Date; items: Position[] }>()
    for (const p of favorites) {
      const d = parseSignupDeadline(p)
      if (!d) continue
      const n = daysUntil(d)
      if (n < -7 || n > 14) continue
      const key = d.toDateString()
      if (!byDay.has(key)) byDay.set(key, { date: d, items: [] })
      byDay.get(key)!.items.push(p)
    }
    return [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [favorites])

  function renderRow(p: Position) {
    return (
      <div key={p.id} className="px-4 py-3 hover:bg-muted/50 sm:px-6">
      <div className="flex items-start gap-2">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(p)}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[11px]">
              {p.year}
            </Badge>
            <span className="line-clamp-1 text-sm font-medium">
              {p.position_example || p.exam_type || '-'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex max-w-full items-center gap-1">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{p.employer || '-'}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3 shrink-0" />
              {p.work_location || '-'}
            </span>
          </div>
        </button>
        <Select
          value={statuses[p.id] || '未投递'}
          onValueChange={(v) => setAppStatus(p.id, v as AppStatus)}
        >
          <SelectTrigger
            size="sm"
            className={`h-7 w-auto gap-1 border-none px-2 text-[11px] font-medium shadow-none ${STATUS_COLORS[(statuses[p.id] || '未投递') as AppStatus]}`}
          >
            {statuses[p.id] || '未投递'}
          </SelectTrigger>
          <SelectContent>
            {APP_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <CompareButton item={p} />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="取消收藏"
          onClick={() => toggleFavorite(p)}
        >
          <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Select
          value={channels[p.id] || ''}
          onValueChange={(v) => setAppChannel(p.id, (v || null) as AppChannel | null)}
        >
          <SelectTrigger
            size="sm"
            className={cn(
              'h-6 w-auto gap-1 border-none px-2 text-[11px] font-medium shadow-none',
              channels[p.id]
                ? channelClass(channels[p.id])
                : 'bg-muted/60 text-muted-foreground',
            )}
          >
            {channels[p.id] || '渠道'}
          </SelectTrigger>
          <SelectContent>
            {APP_CHANNELS.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">
                <span className={cn(PILL_BASE, channelClass(c))}>{c}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {noteEditing === p.id ? (
          <Input
            autoFocus
            defaultValue={notes[p.id] || ''}
            placeholder="添加备注，回车保存"
            className="h-7 flex-1 text-xs"
            onBlur={(e) => {
              setAppNote(p.id, e.target.value)
              setNoteEditing(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setAppNote(p.id, (e.target as HTMLInputElement).value)
                setNoteEditing(null)
              } else if (e.key === 'Escape') {
                setNoteEditing(null)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setNoteEditing(p.id)}
          >
            <StickyNote className="h-3 w-3 shrink-0" />
            {notes[p.id] ? (
              <span className="truncate">{notes[p.id]}</span>
            ) : (
              '备注'
            )}
          </button>
        )}
      </div>
      </div>
    )
  }

  async function shareFavorites() {
    await copyText(favoritesShareUrl(favorites.map((p) => p.id)))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full max-w-2xl p-0 sm:max-w-md">
          <SheetHeader className="space-y-1.5 px-4 pt-6 sm:px-6">
            <SheetTitle className="flex items-center gap-2 pr-8 text-lg">
              <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
              我的收藏
              <Badge variant="secondary">{favorites.length}</Badge>
            </SheetTitle>
            {favorites.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={shareFavorites}
                  >
                    {copied ? (
                      <>
                        <Check className="mr-1 h-3.5 w-3.5 text-green-600" />
                        已复制
                      </>
                    ) : (
                      <>
                        <Link2 className="mr-1 h-3.5 w-3.5" />
                        分享收藏夹
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={clearFavorites}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    清空
                  </Button>
              </div>
            )}
          </SheetHeader>
          {favorites.length > 0 && (
            <div className="space-y-2 px-4 pb-1 sm:px-6">
              <div className="flex items-center gap-1">
                <Button
                  variant={view === 'track' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setView('track')}
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  投递追踪
                </Button>
                <Button
                  variant={view === 'calendar' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setView('calendar')}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  截止日历
                </Button>
              </div>
              {view === 'track' && (
                <div className="flex flex-wrap gap-1.5">
                  {APP_STATUSES.filter((s) => statusCounts[s]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={statusFilter === s}
                      className={`cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-medium transition-shadow ${STATUS_COLORS[s]} ${
                        statusFilter === s ? 'ring-2 ring-primary/50' : statusFilter ? 'opacity-50' : ''
                      }`}
                      onClick={() => setStatusFilter((cur) => (cur === s ? null : s))}
                    >
                      {s} {statusCounts[s]}
                    </button>
                  ))}
                  {statusFilter && (
                    <button
                      type="button"
                      className="cursor-pointer rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                      onClick={() => setStatusFilter(null)}
                    >
                      清除筛选
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <ScrollArea className="min-h-0 flex-1">
            {favorites.length === 0 ? (
              <EmptyState
                icon={Star}
                className="m-4 sm:m-6"
                title="还没有收藏岗位"
                description="点击岗位列表或详情里的星标即可收藏，方便追踪投递进度"
              />
            ) : view === 'track' ? (
              <div>
                {groups.map((g) => (
                  <div key={g.status}>
                    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-popover px-4 py-1.5 sm:px-6">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[g.status]}`}>
                        {g.status}
                      </span>
                      <span className="text-xs text-muted-foreground">{g.items.length} 个岗位</span>
                    </div>
                    <div className="divide-y">{g.items.map((p) => renderRow(p))}</div>
                  </div>
                ))}
                {groups.length === 0 && (
                  <EmptyState
                    className="m-4 sm:m-6"
                    title="该状态下暂无岗位"
                    description="点击上方状态徽章可切换筛选"
                  />
                )}
              </div>
            ) : (
              <div className="space-y-1 pb-4">
                {calendarDays.map(({ date, items }) => {
                  const n = daysUntil(date)
                  const expired = n < 0
                  return (
                    <div key={date.toDateString()} className={expired ? 'opacity-50' : undefined}>
                      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-popover px-4 py-1.5 sm:px-6">
                        <span className="text-xs font-semibold">{formatDayLabel(date)}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            expired
                              ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                              : n <= 1
                              ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                              : n <= 3
                              ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                        >
                          {expired ? '已截止' : n === 0 ? '今日截止' : `剩 ${n} 天`}
                        </span>
                      </div>
                      <div className="divide-y">{items.map((p) => renderRow(p))}</div>
                    </div>
                  )
                })}
                {calendarDays.length === 0 && (
                  <EmptyState
                    icon={CalendarDays}
                    className="m-4 sm:m-6"
                    title="近 14 天内没有即将截止的收藏岗位"
                    description="收藏更多岗位后，这里会按截止日期提醒你报名"
                  />
                )}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
      {selected && <PositionSheet item={selected} onClose={() => setSelected(null)} />}
    </>
  )
}
