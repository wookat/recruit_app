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
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

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

export function CalendarPage() {
  const today = useMemo(() => new Date(), [])
  const [monthOffset, setMonthOffset] = useState(0)
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
    for (const j of campusJobs ?? []) {
      const iso = campusDateIso(j)
      if (iso) ensure(iso).campus.push(j)
    }
    for (const j of bianzhiJobs ?? []) {
      const iso = bianzhiDateIso(j)
      if (iso) ensure(iso).bianzhi.push(j)
    }
    return map
  }, [campusJobs, bianzhiJobs])

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

  const todayIso = isoOf(today)
  const loading = campusJobs === null || bianzhiJobs === null
  const selectedDay = selectedIso ? byDate[selectedIso] : null

  const campusShare = (j: CampusJob) =>
    buildShareText({
      org: j.company,
      title: j.positions,
      location: j.locations,
      deadline: j.deadline_text,
      url: j.apply_url || j.announce_url,
    })

  const bianzhiShare = (j: BianzhiJob) =>
    buildShareText({
      org: bianzhiTitle(j) === '-' ? null : bianzhiTitle(j),
      title: j.job_type,
      location: j.work_location || j.province,
      deadline: j.deadline_text || j.deadline_date,
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
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label="上个月"
            onClick={() => setMonthOffset((m) => m - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-24 text-center text-sm font-medium">
            {monthStart.getFullYear()} 年 {monthStart.getMonth() + 1} 月
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label="下个月"
            onClick={() => setMonthOffset((m) => m + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {monthOffset !== 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => {
                setMonthOffset(0)
                setSelectedIso(todayIso)
              }}
            >
              回今天
            </Button>
          )}
        </div>
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

      {loading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
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
                    <span className="rounded bg-blue-500/15 px-1 text-[10px] font-medium leading-4 text-blue-600 dark:text-blue-400">
                      {day.campus.length}
                    </span>
                  )}
                  {day && day.bianzhi.length > 0 && (
                    <span className="rounded bg-violet-500/15 px-1 text-[10px] font-medium leading-4 text-violet-600 dark:text-violet-400">
                      {day.bianzhi.length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {selectedIso && (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold">
            {Number(selectedIso.slice(5, 7))} 月 {Number(selectedIso.slice(8, 10))} 日截止
          </h3>
          {!selectedDay || (selectedDay.campus.length === 0 && selectedDay.bianzhi.length === 0) ? (
            <EmptyState title="当日无截止岗位" description="换个日期看看，或关注收藏截止提醒" />
          ) : (
            <ul className="mt-2 divide-y">
              {selectedDay.campus.map((j) => (
                <li key={`c-${j.id}`}>
                  <button
                    type="button"
                    className="flex w-full min-h-11 flex-wrap items-center gap-2 py-2 text-left hover:bg-muted/50"
                    onClick={() => setCampusDetail(j)}
                  >
                    <Badge className="border-0 bg-blue-500/15 text-blue-600 dark:text-blue-400">校招</Badge>
                    <span className="text-sm font-medium">{j.company || '-'}</span>
                    {j.positions && (
                      <span className="line-clamp-1 text-xs text-muted-foreground">{j.positions}</span>
                    )}
                  </button>
                </li>
              ))}
              {selectedDay.bianzhi.map((j) => (
                <li key={`b-${j.id}`}>
                  <button
                    type="button"
                    className="flex w-full min-h-11 flex-wrap items-center gap-2 py-2 text-left hover:bg-muted/50"
                    onClick={() => setBianzhiDetail(j)}
                  >
                    <Badge className="border-0 bg-violet-500/15 text-violet-600 dark:text-violet-400">编制</Badge>
                    <span className="text-sm font-medium">{bianzhiTitle(j)}</span>
                    {j.job_type && (
                      <span className="line-clamp-1 text-xs text-muted-foreground">{j.job_type}</span>
                    )}
                  </button>
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
