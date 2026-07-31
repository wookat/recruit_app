import { useMemo, useState } from 'react'
import type { BianzhiJob, CampusJob, Position } from '@/api'
import { daysUntil, formatDayLabel, parseDeadlineText, parseSignupDeadline } from '@/lib/deadline'
import {
  APP_STATUSES,
  STATUS_COLORS,
  clearFavorites,
  setAppChannel,
  setAppNote,
  setAppStatus,
  toggleAppPriority,
  toggleFavorite,
  useAppChannels,
  useAppPriorities,
  useAppNotes,
  useAppStatuses,
  useFavorites,
  type AppStatus,
} from '@/lib/positionStore'
import {
  setBoardNote,
  setBoardStatus,
  toggleBianzhiFavorite,
  toggleBoardPriority,
  toggleCampusFavorite,
  useBianzhiFavorites,
  useBianzhiMeta,
  useCampusFavorites,
  useCampusMeta,
  type BoardKind,
  type BoardMeta,
} from '@/lib/boardFavorites'
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
import { Building2, Download, ExternalLink, Flag, MapPin, Search, Star, Trash2, Link2, Check, CalendarDays, ListChecks, StickyNote } from 'lucide-react'
import { EmptyState } from './EmptyState'

interface Props {
  open: boolean
  onClose: () => void
}

type Board = 'positions' | 'campus' | 'bianzhi'

interface CalendarEntry {
  date: Date
  kind: Board
  position?: Position
  campus?: CampusJob
  bianzhi?: BianzhiJob
}

export function FavoritesSheet({ open, onClose }: Props) {
  const favorites = useFavorites()
  const campusFavs = useCampusFavorites()
  const bianzhiFavs = useBianzhiFavorites()
  const campusMeta = useCampusMeta()
  const bianzhiMeta = useBianzhiMeta()
  const statuses = useAppStatuses()
  const notes = useAppNotes()
  const channels = useAppChannels()
  const priorities = useAppPriorities()
  const [selected, setSelected] = useState<Position | null>(null)
  const [noteEditing, setNoteEditing] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [board, setBoard] = useState<Board>('positions')
  const [view, setView] = useState<'track' | 'calendar'>('track')
  const [statusFilter, setStatusFilter] = useState<AppStatus | null>(null)
  const [query, setQuery] = useState('')

  const totalCount = favorites.length + campusFavs.length + bianzhiFavs.length
  const boardCount =
    board === 'positions' ? favorites.length : board === 'campus' ? campusFavs.length : bianzhiFavs.length

  const statusOf = (kind: Board, id: number): AppStatus => {
    if (kind === 'positions') return statuses[id] || '未投递'
    const meta = kind === 'campus' ? campusMeta : bianzhiMeta
    return meta[id]?.status || '未投递'
  }

  const q = query.trim().toLowerCase()

  const hitQuery = (fields: (string | null | undefined)[]): boolean =>
    !q || fields.some((f) => f && f.toLowerCase().includes(q))

  const matchPosition = (p: Position) =>
    hitQuery([p.employer, p.position_example, p.exam_type, p.work_location, notes[p.id]])
  const matchCampus = (j: CampusJob) =>
    hitQuery([j.company, j.positions, j.industry, campusMeta[j.id]?.note])
  const matchBianzhi = (j: BianzhiJob) =>
    hitQuery([j.employer, j.category, j.province, j.work_location, bianzhiMeta[j.id]?.note])
  const matchEntry = (e: Omit<CalendarEntry, 'date'>) =>
    e.kind === 'positions'
      ? matchPosition(e.position!)
      : e.kind === 'campus'
      ? matchCampus(e.campus!)
      : matchBianzhi(e.bianzhi!)

  const statusCounts = useMemo(() => {
    const acc: Record<string, number> = {}
    const ids =
      board === 'positions'
        ? favorites.map((p) => p.id)
        : (board === 'campus' ? campusFavs : bianzhiFavs).map((j) => j.id)
    for (const id of ids) {
      const s = statusOf(board, id)
      acc[s] = (acc[s] || 0) + 1
    }
    return acc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, favorites, campusFavs, bianzhiFavs, statuses, campusMeta, bianzhiMeta])

  function sortByPriority<T extends { id: number }>(items: T[], meta: Record<number, BoardMeta>) {
    return [...items].sort((a, b) => Number(!!meta[b.id]?.priority) - Number(!!meta[a.id]?.priority))
  }

  const groups = APP_STATUSES.map((s) => {
    let items: (Position | CampusJob | BianzhiJob)[]
    if (board === 'positions') {
      items = favorites
        .filter((p) => statusOf('positions', p.id) === s && matchPosition(p))
        .sort((a, b) => Number(!!priorities[b.id]) - Number(!!priorities[a.id]))
    } else if (board === 'campus') {
      items = sortByPriority(
        campusFavs.filter((j) => statusOf('campus', j.id) === s && matchCampus(j)),
        campusMeta,
      )
    } else {
      items = sortByPriority(
        bianzhiFavs.filter((j) => statusOf('bianzhi', j.id) === s && matchBianzhi(j)),
        bianzhiMeta,
      )
    }
    return { status: s, items }
  }).filter((g) => g.items.length > 0 && (!statusFilter || g.status === statusFilter))

  const { calendarDays, undated } = useMemo(() => {
    const byDay = new Map<string, { date: Date; entries: CalendarEntry[] }>()
    const undated: { kind: Board; label: string; entry: Omit<CalendarEntry, 'date'> }[] = []
    const push = (
      date: Date | null,
      entry: Omit<CalendarEntry, 'date'>,
      rawText: string | null | undefined,
    ) => {
      if (!date) {
        const label = (rawText || '').trim()
        if (label) undated.push({ kind: entry.kind, label, entry })
        return
      }
      const n = daysUntil(date)
      if (n < -7 || n > 14) return
      const key = date.toDateString()
      if (!byDay.has(key)) byDay.set(key, { date, entries: [] })
      byDay.get(key)!.entries.push({ ...entry, date })
    }
    for (const p of favorites) {
      push(parseSignupDeadline(p), { kind: 'positions', position: p }, p.signup_time)
    }
    for (const j of campusFavs) {
      push(parseDeadlineText(j.deadline_text), { kind: 'campus', campus: j }, j.deadline_text)
    }
    for (const j of bianzhiFavs) {
      push(parseDeadlineText(j.deadline_text), { kind: 'bianzhi', bianzhi: j }, j.deadline_text)
    }
    return {
      calendarDays: [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime()),
      undated,
    }
  }, [favorites, campusFavs, bianzhiFavs])

  const filteredCalendarDays = calendarDays
    .map((d) => ({ ...d, entries: d.entries.filter(matchEntry) }))
    .filter((d) => d.entries.length > 0)
  const filteredUndated = undated.filter((u) => matchEntry(u.entry))

  function renderMetaRow(opts: {
    kind: BoardKind
    id: number
    meta: BoardMeta | undefined
  }) {
    const { kind, id, meta } = opts
    const noteKey = `${kind}:${id}`
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={!!meta?.priority}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
            meta?.priority
              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
              : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          onClick={() => toggleBoardPriority(kind, id)}
        >
          <Flag className="h-3 w-3" />
          {meta?.priority ? '优先' : '一般'}
        </button>
        {noteEditing === noteKey ? (
          <Input
            autoFocus
            defaultValue={meta?.note || ''}
            placeholder="添加备注，回车保存"
            className="h-7 flex-1 text-xs"
            onBlur={(e) => {
              setBoardNote(kind, id, e.target.value)
              setNoteEditing(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setBoardNote(kind, id, (e.target as HTMLInputElement).value)
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
            onClick={() => setNoteEditing(noteKey)}
          >
            <StickyNote className="h-3 w-3 shrink-0" />
            {meta?.note ? <span className="truncate">{meta.note}</span> : '备注'}
          </button>
        )}
      </div>
    )
  }

  function renderStatusSelect(kind: Board, id: number) {
    const current = statusOf(kind, id)
    return (
      <Select
        value={current}
        onValueChange={(v) =>
          kind === 'positions'
            ? setAppStatus(id, v as AppStatus)
            : setBoardStatus(kind, id, v as AppStatus)
        }
      >
        <SelectTrigger
          size="sm"
          className={`h-7 w-auto gap-1 border-none px-2 text-[11px] font-medium shadow-none ${STATUS_COLORS[current]}`}
        >
          {current}
        </SelectTrigger>
        <SelectContent>
          {APP_STATUSES.map((s) => (
            <SelectItem key={s} value={s} className="text-xs">
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  function renderCampusRow(j: CampusJob) {
    return (
      <div key={j.id} className="px-4 py-3 hover:bg-muted/50 sm:px-6">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="line-clamp-1 text-sm font-medium">{j.company || '-'}</span>
              {j.company_type && (
                <Badge variant="secondary" className="text-[11px]">
                  {j.company_type}
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {j.positions && <span className="line-clamp-1">{j.positions}</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {j.deadline_text && <span>截止：{j.deadline_text}</span>}
              {j.apply_url && j.apply_url.startsWith('http') && (
                <a
                  href={j.apply_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  投递链接 <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          {renderStatusSelect('campus', j.id)}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="取消收藏"
            onClick={() => toggleCampusFavorite(j)}
          >
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
          </Button>
        </div>
        {renderMetaRow({ kind: 'campus', id: j.id, meta: campusMeta[j.id] })}
      </div>
    )
  }

  function renderBianzhiRow(j: BianzhiJob) {
    return (
      <div key={j.id} className="px-4 py-3 hover:bg-muted/50 sm:px-6">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="line-clamp-1 text-sm font-medium">{j.employer || j.category || '-'}</span>
              {j.category && (
                <Badge variant="secondary" className="text-[11px]">
                  {j.category}
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {j.province && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {j.province}
                </span>
              )}
              {j.deadline_text && <span>截止：{j.deadline_text}</span>}
              {j.announce_url && j.announce_url.startsWith('http') && (
                <a
                  href={j.announce_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  公告链接 <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          {renderStatusSelect('bianzhi', j.id)}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="取消收藏"
            onClick={() => toggleBianzhiFavorite(j)}
          >
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
          </Button>
        </div>
        {renderMetaRow({ kind: 'bianzhi', id: j.id, meta: bianzhiMeta[j.id] })}
      </div>
    )
  }

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
        {renderStatusSelect('positions', p.id)}
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
        <button
          type="button"
          aria-pressed={!!priorities[p.id]}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
            priorities[p.id]
              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
              : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          onClick={() => toggleAppPriority(p.id)}
        >
          <Flag className="h-3 w-3" />
          {priorities[p.id] ? '优先' : '一般'}
        </button>
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
        {noteEditing === `positions:${p.id}` ? (
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
            onClick={() => setNoteEditing(`positions:${p.id}`)}
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

  function renderEntry(e: CalendarEntry) {
    if (e.kind === 'positions' && e.position) return renderRow(e.position)
    if (e.kind === 'campus' && e.campus) return renderCampusRow(e.campus)
    if (e.kind === 'bianzhi' && e.bianzhi) return renderBianzhiRow(e.bianzhi)
    return null
  }

  async function shareFavorites() {
    await copyText(favoritesShareUrl(favorites.map((p) => p.id)))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const exportPositions = favorites.filter(matchPosition)
  const exportCampus = campusFavs.filter(matchCampus)
  const exportBianzhi = bianzhiFavs.filter(matchBianzhi)
  const exportCount =
    board === 'positions'
      ? exportPositions.length
      : board === 'campus'
      ? exportCampus.length
      : exportBianzhi.length

  function exportCsv() {
    const esc = (v: string | number | null | undefined) =>
      `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['板块', '单位/公司', '岗位', '地点', '截止', '投递状态', '渠道', '优先级', '备注', '链接']
    let rows: (string | number | null | undefined)[][]
    if (board === 'positions') {
      rows = exportPositions.map((p) => [
        '体制内',
        p.employer,
        p.position_example || p.exam_type,
        p.work_location,
        p.signup_time,
        statusOf('positions', p.id),
        channels[p.id] || '',
        priorities[p.id] ? '优先' : '',
        notes[p.id] || '',
        p.source_url || '',
      ])
    } else if (board === 'campus') {
      rows = exportCampus.map((j) => [
        '校招',
        j.company,
        j.positions,
        j.locations,
        j.deadline_text,
        statusOf('campus', j.id),
        '',
        campusMeta[j.id]?.priority ? '优先' : '',
        campusMeta[j.id]?.note || '',
        j.apply_url || j.announce_url || '',
      ])
    } else {
      rows = exportBianzhi.map((j) => [
        '编制',
        j.employer || j.category,
        j.job_type,
        j.province || j.work_location,
        j.deadline_text,
        statusOf('bianzhi', j.id),
        '',
        bianzhiMeta[j.id]?.priority ? '优先' : '',
        bianzhiMeta[j.id]?.note || '',
        j.announce_url || j.apply_url || '',
      ])
    }
    const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `收藏_${board === 'positions' ? '体制内' : board === 'campus' ? '校招' : '编制'}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const BOARD_TABS: { key: Board; label: string; count: number }[] = [
    { key: 'positions', label: '体制内', count: favorites.length },
    { key: 'campus', label: '校招', count: campusFavs.length },
    { key: 'bianzhi', label: '编制', count: bianzhiFavs.length },
  ]

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full max-w-2xl p-0 sm:max-w-md">
          <SheetHeader className="space-y-1.5 px-4 pt-6 sm:px-6">
            <SheetTitle className="flex items-center gap-2 pr-8 text-lg">
              <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
              我的收藏
              <Badge variant="secondary">{totalCount}</Badge>
            </SheetTitle>
            {boardCount > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={exportCsv}
                  disabled={exportCount === 0}
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  {q ? `导出 CSV (${exportCount})` : '导出 CSV'}
                </Button>
                {board === 'positions' && (
                  <>
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
                  </>
                )}
              </div>
            )}
          </SheetHeader>
          <div className="space-y-2 px-4 pb-1 sm:px-6">
            <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
              {BOARD_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={board === t.key}
                  className={cn(
                    'min-h-11 flex-1 cursor-pointer rounded-md px-2 py-1 text-xs font-medium transition-colors sm:min-h-9',
                    board === t.key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => {
                    setBoard(t.key)
                    setStatusFilter(null)
                  }}
                >
                  {t.label}
                  {t.count > 0 && <span className="ml-1 opacity-70">{t.count}</span>}
                </button>
              ))}
            </div>
            {boardCount > 0 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜单位 / 公司 / 岗位 / 备注…"
                  className="h-9 pl-8 text-xs"
                />
              </div>
            )}
            {boardCount > 0 && (
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
            )}
            {boardCount > 0 && view === 'track' && (
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
          <ScrollArea className="min-h-0 flex-1">
            {view === 'track' ? (
              boardCount === 0 ? (
                <EmptyState
                  icon={Star}
                  className="m-4 sm:m-6"
                  title={
                    board === 'positions'
                      ? '还没有收藏岗位'
                      : board === 'campus'
                      ? '还没有收藏校招信息'
                      : '还没有收藏编制公告'
                  }
                  description="点击列表里的星标即可收藏，方便追踪投递进度"
                />
              ) : (
                <div>
                  {groups.map((g) => (
                    <div key={g.status}>
                      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-popover px-4 py-1.5 sm:px-6">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[g.status]}`}>
                          {g.status}
                        </span>
                        <span className="text-xs text-muted-foreground">{g.items.length} 个岗位</span>
                      </div>
                      <div className="divide-y">
                        {g.items.map((item) =>
                          board === 'positions'
                            ? renderRow(item as Position)
                            : board === 'campus'
                            ? renderCampusRow(item as CampusJob)
                            : renderBianzhiRow(item as BianzhiJob),
                        )}
                      </div>
                    </div>
                  ))}
                  {groups.length === 0 && (
                    <EmptyState
                      className="m-4 sm:m-6"
                      title={q ? '无匹配收藏' : '该状态下暂无岗位'}
                      description={
                        q ? '换个关键词试试，或清空搜索框' : '点击上方状态徽章可切换筛选'
                      }
                    />
                  )}
                </div>
              )
            ) : (
              <div className="space-y-1 pb-4">
                {filteredCalendarDays.map(({ date, entries }) => {
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
                      <div className="divide-y">
                        {entries.map((e) => (
                          <div key={`${e.kind}-${(e.position ?? e.campus ?? e.bianzhi)!.id}`}>
                            <div className="flex items-center gap-1 px-4 pt-2 sm:px-6">
                              <span className={cn(PILL_BASE, 'bg-muted/60 text-muted-foreground')}>
                                {e.kind === 'positions' ? '体制内' : e.kind === 'campus' ? '校招' : '编制'}
                              </span>
                            </div>
                            {renderEntry(e)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {filteredUndated.length > 0 && (
                  <div>
                    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-popover px-4 py-1.5 sm:px-6">
                      <span className="text-xs font-semibold">无固定截止日期</span>
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                        {filteredUndated.length} 条（招满为止/详见公告等）
                      </span>
                    </div>
                    <div className="divide-y">
                      {filteredUndated.map(({ kind, label, entry }) => (
                        <div key={`u-${kind}-${(entry.position ?? entry.campus ?? entry.bianzhi)!.id}`}>
                          <div className="flex flex-wrap items-center gap-1 px-4 pt-2 sm:px-6">
                            <span className={cn(PILL_BASE, 'bg-muted/60 text-muted-foreground')}>
                              {kind === 'positions' ? '体制内' : kind === 'campus' ? '校招' : '编制'}
                            </span>
                            <span className="text-[11px] text-muted-foreground">{label}</span>
                          </div>
                          {renderEntry({ ...entry, date: new Date() })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {filteredCalendarDays.length === 0 && filteredUndated.length === 0 && (
                  <EmptyState
                    icon={CalendarDays}
                    className="m-4 sm:m-6"
                    title={q ? '无匹配收藏' : '近 14 天内没有即将截止的收藏岗位'}
                    description={
                      q
                        ? '换个关键词试试，或清空搜索框'
                        : '收藏更多岗位后，这里会按截止日期提醒你报名'
                    }
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
