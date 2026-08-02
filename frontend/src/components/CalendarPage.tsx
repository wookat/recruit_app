import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchBianzhiJobs,
  fetchCampusJobs,
  type BianzhiJob,
  type CampusJob,
} from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { BoardJobSheet } from '@/components/BoardJobSheet'
import { buildShareText } from '@/components/ShareTextButton'
import { readJobParam } from '@/lib/jobDeepLink'
import { sheetNavProps } from '@/lib/sheetNav'
import { parseDeadlineText, parseSignupDeadline } from '@/lib/deadline'
import { useFavorites } from '@/lib/positionStore'
import {
  toggleBianzhiFavorite,
  toggleCampusFavorite,
  useBianzhiFavorites,
  useCampusFavorites,
} from '@/lib/boardFavorites'
import { cn } from '@/lib/utils'
import { BoardFavoriteButton } from '@/components/BoardFavoriteButton'
import { downloadIcs, type IcsEvent } from '@/lib/ics'
import { CalendarDays, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { jobShareUrl } from '@/lib/clipboard'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function campusDateIso(j: CampusJob): string | null {
  if (j.deadline_date) return j.deadline_date.slice(0, 10)
  const d = parseDeadlineText(j.deadline_text)
  return d ? isoOf(d) : null
}

function bianzhiDateIso(j: BianzhiJob): string | null {
  if (j.deadline_date) return j.deadline_date.slice(0, 10)
  const d = parseDeadlineText(j.deadline_text)
  return d ? isoOf(d) : null
}

function bianzhiTitle(j: BianzhiJob): string {
  return (
    j.employer ||
    (j.category === '大型联考' ? `${j.province ?? ''}${j.job_type ?? ''}联考` : '-')
  )
}

interface DayData {
  campus: CampusJob[]
  bianzhi: BianzhiJob[]
}

type CalView = 'month' | 'week'

type CalBoard = 'all' | 'campus' | 'bianzhi' | 'fav'

const CAL_BOARDS: { key: CalBoard; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'campus', label: '校招' },
  { key: 'bianzhi', label: '编制' },
  { key: 'fav', label: '收藏' },
]

function initialView(): CalView {
  return new URLSearchParams(window.location.search).get('cview') === 'week' ? 'week' : 'month'
}

function initialCalBoard(): CalBoard {
  const v = new URLSearchParams(window.location.search).get('cboard')
  return v === 'campus' || v === 'bianzhi' || v === 'fav' ? v : 'all'
}

function syncViewParam(view: CalView, calBoard: CalBoard) {
  const q = new URLSearchParams(window.location.search)
  if (q.get('board') !== 'calendar') return
  if (view === 'week') q.set('cview', 'week')
  else q.delete('cview')
  if (calBoard !== 'all') q.set('cboard', calBoard)
  else q.delete('cboard')
  window.history.replaceState(null, '', `?${q.toString()}${window.location.hash}`)
}

export function CalendarPage() {
  const today = useMemo(() => new Date(), [])
  const [monthOffset, setMonthOffset] = useState(0)
  const [view, setView] = useState<CalView>(initialView)
  const [calBoard, setCalBoard] = useState<CalBoard>(initialCalBoard)
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedIso, setSelectedIso] = useState<string | null>(null)
  const [campusJobs, setCampusJobs] = useState<CampusJob[] | null>(null)
  const [bianzhiJobs, setBianzhiJobs] = useState<BianzhiJob[] | null>(null)
  const [campusDetail, setCampusDetail] = useState<CampusJob | null>(null)
  const [bianzhiDetail, setBianzhiDetail] = useState<BianzhiJob | null>(null)
  const deepLinkDone = useRef(false)
  const favorites = useFavorites()
  const campusFavs = useCampusFavorites()
  const bianzhiFavs = useBianzhiFavorites()

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      fetchCampusJobs({ due_within_days: 60, page: 1, page_size: 100 }),
      fetchBianzhiJobs({ due_within_days: 60, page: 1, page_size: 100 }),
    ]).then(([c, b]) => {
      if (cancelled) return
      const campus = c.status === 'fulfilled' ? c.value.items : []
      const bianzhi = b.status === 'fulfilled' ? b.value.items : []
      setCampusJobs(campus)
      setBianzhiJobs(bianzhi)
      if (!deepLinkDone.current) {
        deepLinkDone.current = true
        const cid = readJobParam('campus')
        const bid = readJobParam('bianzhi')
        if (cid) {
          const hit = campus.find((j) => j.id === cid)
          if (hit) {
            setCampusDetail(hit)
            setSelectedIso(campusDateIso(hit))
          }
        } else if (bid) {
          const hit = bianzhi.find((j) => j.id === bid)
          if (hit) {
            setBianzhiDetail(hit)
            setSelectedIso(bianzhiDateIso(hit))
          }
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const byDate = useMemo(() => {
    const map: Record<string, DayData> = {}
    const ensure = (iso: string) => (map[iso] ??= { campus: [], bianzhi: [] })
    const showCampus = calBoard === 'all' || calBoard === 'campus' || calBoard === 'fav'
    const showBianzhi = calBoard === 'all' || calBoard === 'bianzhi' || calBoard === 'fav'
    for (const j of campusJobs ?? []) {
      if (!showCampus) continue
      if (calBoard === 'fav' && !campusFavs.some((f) => f.id === j.id)) continue
      const iso = campusDateIso(j)
      if (iso) ensure(iso).campus.push(j)
    }
    for (const j of bianzhiJobs ?? []) {
      if (!showBianzhi) continue
      if (calBoard === 'fav' && !bianzhiFavs.some((f) => f.id === j.id)) continue
      const iso = bianzhiDateIso(j)
      if (iso) ensure(iso).bianzhi.push(j)
    }
    return map
  }, [campusJobs, bianzhiJobs, calBoard, campusFavs, bianzhiFavs])

  const favDates = useMemo(() => {
    const set = new Set<string>()
    for (const p of favorites) {
      const d = parseSignupDeadline(p)
      if (d) set.add(isoOf(d))
    }
    for (const j of campusFavs) {
      const d = parseDeadlineText(j.deadline_text)
      if (d) set.add(isoOf(d))
    }
    for (const j of bianzhiFavs) {
      const d = parseDeadlineText(j.deadline_text)
      if (d) set.add(isoOf(d))
    }
    return set
  }, [favorites, campusFavs, bianzhiFavs])

  const monthStart = useMemo(
    () => new Date(today.getFullYear(), today.getMonth() + monthOffset, 1),
    [today, monthOffset],
  )

  const cells = useMemo(() => {
    const daysInMonth = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth() + 1,
      0,
    ).getDate()
    const lead = (monthStart.getDay() + 6) % 7
    const out: (Date | null)[] = Array.from({ length: lead }, () => null)
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), d))
    }
    return out
  }, [monthStart])

  useEffect(() => {
    syncViewParam(view, calBoard)
  }, [view, calBoard])

  const weekDays = useMemo(() => {
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + weekOffset * 7)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return d
    })
  }, [today, weekOffset])

  const todayIso = isoOf(today)
  const loading = campusJobs === null || bianzhiJobs === null
  const selectedDay = selectedIso ? byDate[selectedIso] : null

  const periodRange = useMemo(() => {
    if (view === 'month') {
      const start = isoOf(monthStart)
      const end = isoOf(
        new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0),
      )
      return { start, end }
    }
    return { start: isoOf(weekDays[0]), end: isoOf(weekDays[6]) }
  }, [view, monthStart, weekDays])

  const periodEntries = useMemo(() => {
    const campus: CampusJob[] = []
    const bianzhi: BianzhiJob[] = []
    for (const [iso, day] of Object.entries(byDate)) {
      if (iso < periodRange.start || iso > periodRange.end) continue
      campus.push(...day.campus)
      bianzhi.push(...day.bianzhi)
    }
    return { campus, bianzhi, total: campus.length + bianzhi.length }
  }, [byDate, periodRange])

  const exportPeriodIcs = () => {
    const events: IcsEvent[] = []
    for (const j of periodEntries.campus) {
      const iso = campusDateIso(j)
      if (!iso) continue
      events.push({
        uid: `campus-${j.id}@recruit`,
        date: new Date(`${iso}T00:00:00`),
        summary: `【截止】${j.company || '-'}${j.positions ? ` ${j.positions}` : ''}`,
        description: j.apply_url || j.announce_url || undefined,
      })
    }
    for (const j of periodEntries.bianzhi) {
      const iso = bianzhiDateIso(j)
      if (!iso) continue
      events.push({
        uid: `bianzhi-${j.id}@recruit`,
        date: new Date(`${iso}T00:00:00`),
        summary: `【截止】${bianzhiTitle(j)}${j.job_type ? ` ${j.job_type}` : ''}`,
        description: j.announce_url || j.apply_url || undefined,
      })
    }
    if (events.length === 0) return
    downloadIcs(
      events,
      view === 'month'
        ? `截止日历-${periodRange.start.slice(0, 7)}.ics`
        : `截止日历-${periodRange.start}至${periodRange.end}.ics`,
    )
  }

  const campusShare = (j: CampusJob) =>
    buildShareText({
      org: j.company,
      title: j.positions,
      location: j.locations,
      deadline: j.deadline_text,
      deepLink: jobShareUrl('campus', j.id),
      url: j.announce_url || j.apply_url,
    })

  const bianzhiShare = (j: BianzhiJob) =>
    buildShareText({
      org: bianzhiTitle(j) === '-' ? null : bianzhiTitle(j),
      title: j.job_type,
      location: j.work_location || j.province,
      deadline: j.deadline_text || j.deadline_date,
      deepLink: jobShareUrl('bianzhi', j.id),
      url: j.announce_url || j.apply_url,
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <CalendarDays className="h-5 w-5 text-primary" />
          截止日历
          <span className="text-xs font-normal text-muted-foreground">
            未来 60 天校招 / 编制截止汇总
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
            {(['month', 'week'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn(
                  'min-h-9 cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors sm:min-h-7',
                  view === v
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v === 'month' ? '月' : '周'}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={view === 'month' ? '上个月' : '上一周'}
            onClick={() =>
              view === 'month' ? setMonthOffset((m) => m - 1) : setWeekOffset((w) => w - 1)
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-24 text-center text-sm font-medium">
            {view === 'month'
              ? `${monthStart.getFullYear()} 年 ${monthStart.getMonth() + 1} 月`
              : `${weekDays[0].getMonth() + 1}月${weekDays[0].getDate()}日 – ${weekDays[6].getMonth() + 1}月${weekDays[6].getDate()}日`}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={view === 'month' ? '下个月' : '下一周'}
            onClick={() =>
              view === 'month' ? setMonthOffset((m) => m + 1) : setWeekOffset((w) => w + 1)
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {(view === 'month' ? monthOffset !== 0 : weekOffset !== 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => {
                setMonthOffset(0)
                setWeekOffset(0)
                setSelectedIso(todayIso)
              }}
            >
              回今天
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5" role="group" aria-label="按板块过滤">
          {CAL_BOARDS.map((b) => (
            <button
              key={b.key}
              type="button"
              aria-pressed={calBoard === b.key}
              onClick={() => setCalBoard(b.key)}
              className={cn(
                'min-h-9 cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors sm:min-h-7',
                calBoard === b.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-blue-500" /> 校招
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-violet-500" /> 编制
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> 我的收藏截止
          </span>
        </div>
      </div>

      {!loading && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {view === 'month' ? '本月截止' : '本周截止'}{' '}
            <span className="font-semibold text-foreground">{periodEntries.total}</span> 条
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs max-sm:min-h-11"
            disabled={periodEntries.total === 0}
            onClick={exportPeriodIcs}
          >
            <Download className="h-3.5 w-3.5" />
            {view === 'month' ? '导出本月 .ics' : '导出本周 .ics'}
          </Button>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : view === 'week' ? (
        <div className="space-y-2">
          {weekDays.map((d) => {
            const iso = isoOf(d)
            const day = byDate[iso]
            const isToday = iso === todayIso
            const entries = (day?.campus.length ?? 0) + (day?.bianzhi.length ?? 0)
            return (
              <section
                key={iso}
                className={cn(
                  'rounded-xl border bg-card p-3 shadow-sm',
                  isToday && 'ring-1 ring-primary/40',
                  entries === 0 && !isToday && 'max-sm:py-2',
                )}
              >
                <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {d.getMonth() + 1} 月 {d.getDate()} 日
                  <span className="text-xs font-normal text-muted-foreground">
                    周{WEEKDAYS[(d.getDay() + 6) % 7]}
                  </span>
                  {isToday && (
                    <Badge className="border-0 bg-primary/15 text-primary">今天</Badge>
                  )}
                  {favDates.has(iso) && (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="收藏岗位截止" />
                  )}
                  {entries > 0 && (
                    <span className="text-xs font-normal text-muted-foreground">{entries} 条截止</span>
                  )}
                  {entries === 0 && !isToday && (
                    <span className="text-xs font-normal text-muted-foreground sm:hidden">无截止</span>
                  )}
                </h3>
                {entries === 0 ? (
                  <p
                    className={cn(
                      'mt-1 text-xs text-muted-foreground',
                      !isToday && 'max-sm:hidden',
                    )}
                  >
                    无截止岗位
                  </p>
                ) : (
                  <ul className="mt-1 divide-y">
                    {(day?.campus ?? []).map((j) => (
                      <li key={`c-${j.id}`} className="flex items-center gap-1">
                        <button
                          type="button"
                          className="flex min-h-11 w-full flex-wrap items-center gap-2 py-2 text-left hover:bg-muted/50"
                          onClick={() => {
                            setSelectedIso(iso)
                            setCampusDetail(j)
                          }}
                        >
                          <Badge className="border-0 bg-blue-500/15 text-blue-700 dark:text-blue-400">校招</Badge>
                          <span className="text-sm font-medium">{j.company || '-'}</span>
                          {j.positions && (
                            <span className="line-clamp-1 text-xs text-muted-foreground">{j.positions}</span>
                          )}
                          {j.locations && (
                            <span className="line-clamp-1 text-xs text-muted-foreground">{j.locations}</span>
                          )}
                        </button>
                        <BoardFavoriteButton
                          active={campusFavs.some((f) => f.id === j.id)}
                          onToggle={() => toggleCampusFavorite(j)}
                        />
                      </li>
                    ))}
                    {(day?.bianzhi ?? []).map((j) => (
                      <li key={`b-${j.id}`} className="flex items-center gap-1">
                        <button
                          type="button"
                          className="flex min-h-11 w-full flex-wrap items-center gap-2 py-2 text-left hover:bg-muted/50"
                          onClick={() => {
                            setSelectedIso(iso)
                            setBianzhiDetail(j)
                          }}
                        >
                          <Badge className="border-0 bg-violet-500/15 text-violet-600 dark:bg-purple-500/25 dark:text-purple-300">编制</Badge>
                          <span className="text-sm font-medium">{bianzhiTitle(j)}</span>
                          {j.job_type && (
                            <span className="line-clamp-1 text-xs text-muted-foreground">{j.job_type}</span>
                          )}
                          {(j.work_location || j.province) && (
                            <span className="line-clamp-1 text-xs text-muted-foreground">
                              {j.work_location || j.province}
                            </span>
                          )}
                        </button>
                        <BoardFavoriteButton
                          active={bianzhiFavs.some((f) => f.id === j.id)}
                          onToggle={() => toggleBianzhiFavorite(j)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs text-muted-foreground">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-2">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              if (!d) return <div key={`pad-${i}`} className="min-h-16 border-b border-r sm:min-h-20" />
              const iso = isoOf(d)
              const day = byDate[iso]
              const isToday = iso === todayIso
              const isSelected = iso === selectedIso
              const hasData = !!day && (day.campus.length > 0 || day.bianzhi.length > 0)
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelectedIso(iso)}
                  className={cn(
                    'flex min-h-16 flex-col items-center gap-0.5 border-b border-r p-1 text-left transition-colors sm:min-h-20 sm:p-1.5',
                    hasData && 'cursor-pointer hover:bg-muted/50',
                    isSelected && 'bg-primary/5 ring-1 ring-inset ring-primary/40',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-xs',
                      isToday && 'bg-primary font-semibold text-primary-foreground',
                    )}
                  >
                    {d.getDate()}
                  </span>
                  {favDates.has(iso) && (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="收藏岗位截止" />
                  )}
                  {day && day.campus.length > 0 && (
                    <span className="rounded bg-blue-500/15 px-1 text-[10px] font-medium leading-4 text-blue-700 dark:text-blue-400">
                      {day.campus.length}
                    </span>
                  )}
                  {day && day.bianzhi.length > 0 && (
                    <span className="rounded bg-violet-500/15 px-1 text-[10px] font-medium leading-4 text-violet-600 dark:bg-purple-500/25 dark:text-purple-300">
                      {day.bianzhi.length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {view === 'month' && selectedIso && (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold">
            {Number(selectedIso.slice(5, 7))} 月 {Number(selectedIso.slice(8, 10))} 日截止
          </h3>
          {!selectedDay || (selectedDay.campus.length === 0 && selectedDay.bianzhi.length === 0) ? (
            <EmptyState title="当日无截止岗位" description="换个日期看看，或关注收藏截止提醒" />
          ) : (
            <ul className="mt-2 divide-y">
              {selectedDay.campus.map((j) => (
                <li key={`c-${j.id}`} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex w-full min-h-11 flex-wrap items-center gap-2 py-2 text-left hover:bg-muted/50"
                    onClick={() => setCampusDetail(j)}
                  >
                    <Badge className="border-0 bg-blue-500/15 text-blue-700 dark:text-blue-400">校招</Badge>
                    <span className="text-sm font-medium">{j.company || '-'}</span>
                    {j.positions && (
                      <span className="line-clamp-1 text-xs text-muted-foreground">{j.positions}</span>
                    )}
                  </button>
                  <BoardFavoriteButton
                    active={campusFavs.some((f) => f.id === j.id)}
                    onToggle={() => toggleCampusFavorite(j)}
                  />
                </li>
              ))}
              {selectedDay.bianzhi.map((j) => (
                <li key={`b-${j.id}`} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex w-full min-h-11 flex-wrap items-center gap-2 py-2 text-left hover:bg-muted/50"
                    onClick={() => setBianzhiDetail(j)}
                  >
                    <Badge className="border-0 bg-violet-500/15 text-violet-600 dark:bg-purple-500/25 dark:text-purple-300">编制</Badge>
                    <span className="text-sm font-medium">{bianzhiTitle(j)}</span>
                    {j.job_type && (
                      <span className="line-clamp-1 text-xs text-muted-foreground">{j.job_type}</span>
                    )}
                  </button>
                  <BoardFavoriteButton
                    active={bianzhiFavs.some((f) => f.id === j.id)}
                    onToggle={() => toggleBianzhiFavorite(j)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {campusDetail && (
        <BoardJobSheet
          open={!!campusDetail}
          onClose={() => setCampusDetail(null)}
          title={campusDetail.company || '-'}
          badges={[campusDetail.company_type, campusDetail.source_table].filter(
            (b): b is string => !!b,
          )}
          shareText={campusShare(campusDetail)}
          favActive={campusFavs.some((f) => f.id === campusDetail.id)}
          onFavToggle={() => toggleCampusFavorite(campusDetail)}
          jobKey={`campus:${campusDetail.id}`}
          {...sheetNavProps(selectedDay?.campus ?? [], campusDetail, setCampusDetail)}
          basics={[
            { label: '公司', value: campusDetail.company },
            { label: '招聘岗位', value: campusDetail.positions },
            { label: '企业类型', value: campusDetail.company_type },
            { label: '行业', value: campusDetail.industry },
            { label: '批次', value: campusDetail.batch },
            { label: '届别', value: campusDetail.grad_years },
            { label: '免笔试', value: campusDetail.no_exam },
            { label: '内推码', value: campusDetail.referral_code },
            { label: '工作地点', value: campusDetail.locations },
            { label: '来源', value: campusDetail.source_table },
            { label: '备注', value: campusDetail.notes },
          ]}
          requirements={[
            { label: '学历要求', value: campusDetail.edu_requirement },
            { label: '专业要求', value: campusDetail.major_requirement },
          ]}
          schedule={[
            { label: '开始时间', value: campusDetail.start_date },
            { label: '截止时间', value: campusDetail.deadline_text },
            { label: '更新时间', value: campusDetail.updated_at_src },
          ]}
          links={[
            { label: '投递入口', url: campusDetail.apply_url },
            { label: '公告链接', url: campusDetail.announce_url },
          ]}
        />
      )}
      {bianzhiDetail && (
        <BoardJobSheet
          open={!!bianzhiDetail}
          onClose={() => setBianzhiDetail(null)}
          title={bianzhiTitle(bianzhiDetail)}
          badges={[bianzhiDetail.category, bianzhiDetail.province].filter(
            (b): b is string => !!b,
          )}
          shareText={bianzhiShare(bianzhiDetail)}
          favActive={bianzhiFavs.some((f) => f.id === bianzhiDetail.id)}
          onFavToggle={() => toggleBianzhiFavorite(bianzhiDetail)}
          jobKey={`bianzhi:${bianzhiDetail.id}`}
          {...sheetNavProps(selectedDay?.bianzhi ?? [], bianzhiDetail, setBianzhiDetail)}
          basics={[
            { label: '招聘单位', value: bianzhiDetail.employer },
            { label: '分类', value: bianzhiDetail.category },
            { label: '省份', value: bianzhiDetail.province },
            { label: '岗位类型', value: bianzhiDetail.job_type },
            { label: '招聘人数', value: bianzhiDetail.headcount },
            { label: '工作地点', value: bianzhiDetail.work_location },
            { label: '备注', value: bianzhiDetail.notes },
          ]}
          requirements={[
            { label: '学历要求', value: bianzhiDetail.edu_requirement },
            { label: '专业要求', value: bianzhiDetail.major_requirement },
          ]}
          schedule={[
            { label: '报名开始', value: bianzhiDetail.signup_start },
            { label: '报名截止', value: bianzhiDetail.deadline_text },
            { label: '考试时间', value: bianzhiDetail.exam_time },
            { label: '更新时间', value: bianzhiDetail.updated_at_src },
          ]}
          links={[
            { label: '公告链接', url: bianzhiDetail.announce_url },
            { label: '报名入口', url: bianzhiDetail.apply_url },
          ]}
        />
      )}
    </div>
  )
}
