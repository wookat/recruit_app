import { useMemo, useRef, useState } from 'react'
import type { BianzhiJob, CampusJob, Position } from '@/api'
import { daysUntil, formatDayLabel, getEffectiveDeadline, parseSignupDeadline } from '@/lib/deadline'
import {
  APP_STATUSES,
  STATUS_COLORS,
  clearFavorites,
  setAppChannel,
  setAppNote,
  setAppStatus,
  toggleAppPinned,
  toggleAppPriority,
  toggleFavorite,
  useAppChannels,
  useAppPinned,
  useAppPriorities,
  useAppNotes,
  useAppStatuses,
  useAppStatusHistory,
  useFavorites,
  appendFollowUp,
  type AppStatus,
  type StatusEvent,
} from '@/lib/positionStore'
import {
  appendBoardFollowUp,
  setBoardNote,
  setBoardStatus,
  toggleBianzhiFavorite,
  toggleBoardPinned,
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
import { normalizeDateStr } from '@/lib/tableSort'
import { downloadBackup, restoreBackup } from '@/lib/backup'
import { setConfirmExtLink, useConfirmExtLink } from '@/lib/extLink'
import { downloadIcs, type IcsEvent } from '@/lib/ics'
import { REMIND_OPTIONS, setRemindDays, useRemindDays } from '@/lib/reminderPref'
import {
  enableDueNotification,
  isNotificationSupported,
  setNotifyEnabled,
  useNotifyEnabled,
} from '@/lib/dueNotification'
import {
  enableNewsNotification,
  setNewsNotifyEnabled,
  useNewsNotifyEnabled,
} from '@/lib/savedNews'
import { buildPushItems, disablePush, enablePush, isPushSupported, usePushEnabled } from '@/lib/push'
import { dismissFollowUp, followUpInfo, useFollowUpDismissed } from '@/lib/followup'
import { cn } from '@/lib/utils'
import { stripOrgPrefix } from '@/lib/orgPrefix'
import { Input } from '@/components/ui/input'
import { copyText, favoritesShareUrl, jobShareUrl } from '@/lib/clipboard'
import { LazyPositionSheet } from './LazyPositionSheet'
import { BoardJobSheet } from './BoardJobSheet'
import { buildShareText } from './ShareTextButton'
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
import { AlarmClock, ArrowRight, Bookmark, ChevronDown, Building2, ClipboardList, Download, ExternalLink, Flag, History as HistoryIcon, MapPin, MoreHorizontal, Pin, Search, Star, Trash2, Link2, Check, CalendarDays, DatabaseBackup, FileUp, ListChecks, StickyNote, MonitorSmartphone, Scale, ShieldCheck, Sparkles, Square, SquareCheck } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from './EmptyState'
import { FavCompareDialog, type FavCompareColumn } from './FavCompareDialog'
import { WeeklyDigest } from './WeeklyDigest'
import { SyncCodePanel } from './SyncCodePanel'

interface Props {
  open: boolean
  onClose: () => void
  /** 打开「最近浏览」面板 */
  onOpenHistory?: () => void
  /** 打开时预选的板块 tab（跟随当前浏览板块） */
  initialBoard?: Board
}

type Board = 'positions' | 'campus' | 'bianzhi'

interface CalendarEntry {
  date: Date
  kind: Board
  position?: Position
  campus?: CampusJob
  bianzhi?: BianzhiJob
}

export function FavoritesSheet({ open, onClose, onOpenHistory, initialBoard }: Props) {
  const favorites = useFavorites()
  const campusFavs = useCampusFavorites()
  const bianzhiFavs = useBianzhiFavorites()
  const campusMeta = useCampusMeta()
  const bianzhiMeta = useBianzhiMeta()
  const statuses = useAppStatuses()
  const notes = useAppNotes()
  const channels = useAppChannels()
  const priorities = useAppPriorities()
  const pinnedMap = useAppPinned()
  const statusHistory = useAppStatusHistory()
  const [selected, setSelected] = useState<Position | null>(null)
  const [campusDetail, setCampusDetail] = useState<CampusJob | null>(null)
  const [bianzhiDetail, setBianzhiDetail] = useState<BianzhiJob | null>(null)
  const [noteEditing, setNoteEditing] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [listCopied, setListCopied] = useState(false)
  const [digestOpen, setDigestOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [board, setBoard] = useState<Board>(() => {
    const pref = initialBoard ?? 'positions'
    const counts: Record<Board, number> = {
      positions: favorites.length,
      campus: campusFavs.length,
      bianzhi: bianzhiFavs.length,
    }
    if (counts[pref] > 0) return pref
    const nonEmpty = (['positions', 'campus', 'bianzhi'] as Board[]).find((b) => counts[b] > 0)
    return nonEmpty ?? pref
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [view, setView] = useState<'track' | 'calendar'>('track')
  const [statusFilter, setStatusFilter] = useState<AppStatus | null>(null)
  const [stageFilter, setStageFilter] = useState<AppStatus[] | null>(null)
  const [followupOnly, setFollowupOnly] = useState(false)
  const followDismissed = useFollowUpDismissed()
  const [query, setQuery] = useState('')
  const [restoreMsg, setRestoreMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [compareMode, setCompareMode] = useState(false)
  const [compareSel, setCompareSel] = useState<{ kind: Board; id: number }[]>([])
  const [compareHint, setCompareHint] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [sortMode, setSortMode] = useState<'added' | 'deadline'>(() =>
    localStorage.getItem('recruit.favSort') === 'deadline' ? 'deadline' : 'added',
  )
  const changeSortMode = (m: 'added' | 'deadline') => {
    setSortMode(m)
    try {
      localStorage.setItem('recruit.favSort', m)
    } catch {
      // ignore quota / privacy-mode errors
    }
  }

  const totalCount = favorites.length + campusFavs.length + bianzhiFavs.length
  const boardCount =
    board === 'positions' ? favorites.length : board === 'campus' ? campusFavs.length : bianzhiFavs.length

  const statusOf = (kind: Board, id: number): AppStatus => {
    if (kind === 'positions') return statuses[id] || '未投递'
    const meta = kind === 'campus' ? campusMeta : bianzhiMeta
    return meta[id]?.status || '未投递'
  }

  const compareSelected = (kind: Board, id: number) =>
    compareSel.some((s) => s.kind === kind && s.id === id)

  const toggleCompareSel = (kind: Board, id: number) => {
    if (compareSelected(kind, id)) {
      setCompareHint(null)
      setCompareSel((cur) => cur.filter((s) => !(s.kind === kind && s.id === id)))
      return
    }
    if (compareSel.length > 0 && compareSel[0].kind !== kind) {
      setCompareHint('仅支持同板块收藏对比，请先移除已选或在同一板块内勾选')
      return
    }
    if (compareSel.length >= 3) {
      setCompareHint('最多同时对比 3 条')
      return
    }
    setCompareHint(null)
    setCompareSel((cur) => [...cur, { kind, id }])
  }

  const exitCompare = () => {
    setCompareMode(false)
    setCompareSel([])
    setCompareHint(null)
    setCompareOpen(false)
  }

  const removeCompareSel = (kind: Board, id: number) => {
    setCompareSel((cur) => {
      const next = cur.filter((s) => !(s.kind === kind && s.id === id))
      if (next.length < 2) setCompareOpen(false)
      return next
    })
  }

  const compareColumns: FavCompareColumn[] = compareSel.flatMap((s): FavCompareColumn[] => {
    const priorityText = (v: boolean) => (v ? '优先' : '一般')
    if (s.kind === 'positions') {
      const p = favorites.find((x) => x.id === s.id)
      if (!p) return []
      return [
        {
          key: `positions-${p.id}`,
          title:
            (p.position_example && stripOrgPrefix(p.position_example, p.employer)) ||
            p.exam_type ||
            '-',
          badge: String(p.year),
          onRemove: () => removeCompareSel('positions', p.id),
          onOpenDetail: () => {
            setCompareOpen(false)
            setSelected(p)
          },
          fields: [
            { label: '单位', value: p.employer || '-' },
            { label: '考试类型', value: p.exam_type || '-' },
            { label: '工作地点', value: p.work_location || '-' },
            { label: '学历要求', value: p.edu_level_norm || p.edu_requirement || '-' },
            { label: '本科专业', value: p.undergrad_major || '-' },
            { label: '研究生专业', value: p.grad_major || '-' },
            { label: '报名时间', value: p.signup_time || '-' },
            { label: '状态', value: statusOf('positions', p.id) },
            { label: '优先级', value: priorityText(!!priorities[p.id]) },
            { label: '备注', value: notes[p.id] || '-' },
          ],
        },
      ]
    }
    if (s.kind === 'campus') {
      const j = campusFavs.find((x) => x.id === s.id)
      if (!j) return []
      return [
        {
          key: `campus-${j.id}`,
          title: j.company || '-',
          badge: j.company_type || undefined,
          onRemove: () => removeCompareSel('campus', j.id),
          onOpenDetail: () => {
            setCompareOpen(false)
            setCampusDetail(j)
          },
          fields: [
            { label: '岗位', value: j.positions || '-' },
            { label: '行业', value: j.industry || '-' },
            { label: '工作地点', value: j.locations || '-' },
            { label: '学历要求', value: j.edu_requirement || '-' },
            { label: '专业要求', value: j.major_requirement || '-' },
            { label: '截止', value: j.deadline_text || '-' },
            { label: '状态', value: statusOf('campus', j.id) },
            { label: '优先级', value: priorityText(!!campusMeta[j.id]?.priority) },
            { label: '备注', value: campusMeta[j.id]?.note || '-' },
          ],
        },
      ]
    }
    const j = bianzhiFavs.find((x) => x.id === s.id)
    if (!j) return []
    return [
      {
        key: `bianzhi-${j.id}`,
        title: j.employer || j.category || '-',
        badge: j.category || undefined,
        onRemove: () => removeCompareSel('bianzhi', j.id),
        onOpenDetail: () => {
          setCompareOpen(false)
          setBianzhiDetail(j)
        },
        fields: [
          { label: '省份', value: j.province || '-' },
          { label: '岗位类型', value: j.job_type || '-' },
          { label: '招聘人数', value: j.headcount || '-' },
          { label: '工作地点', value: j.work_location || '-' },
          { label: '学历要求', value: j.edu_requirement || '-' },
          { label: '专业要求', value: j.major_requirement || '-' },
          { label: '截止', value: j.deadline_text || '-' },
          { label: '状态', value: statusOf('bianzhi', j.id) },
          { label: '优先级', value: priorityText(!!bianzhiMeta[j.id]?.priority) },
          { label: '备注', value: bianzhiMeta[j.id]?.note || '-' },
        ],
      },
    ]
  })

  const renderCompareCheck = (kind: Board, id: number) => {
    if (!compareMode) return null
    const checked = compareSelected(kind, id)
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={checked ? '移出对比' : '加入对比'}
        className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center sm:min-h-8 sm:min-w-8"
        onClick={() => toggleCompareSel(kind, id)}
      >
        {checked ? (
          <SquareCheck className="h-4.5 w-4.5 text-primary" />
        ) : (
          <Square className="h-4.5 w-4.5 text-muted-foreground" />
        )}
      </button>
    )
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

  /** 置顶/重点优先，同级内按截止日升序（无截止排末尾）或保持加入顺序。 */
  function sortFavs<T extends { id: number }>(
    items: T[],
    isPinned: (id: number) => boolean,
    isPriority: (id: number) => boolean,
    deadlineOf: (item: T) => Date | null,
  ) {
    const dl = (item: T) => deadlineOf(item)?.getTime() ?? Infinity
    return [...items].sort(
      (a, b) =>
        Number(isPinned(b.id)) - Number(isPinned(a.id)) ||
        Number(isPriority(b.id)) - Number(isPriority(a.id)) ||
        (sortMode === 'deadline' ? dl(a) - dl(b) : 0),
    )
  }

  const STALE_STATUSES: AppStatus[] = ['已投递', '待笔试', '待面试']

  /** 状态为投递中且时间线最后一次变更超过 7 天。 */
  function isStale(status: AppStatus, history: StatusEvent[] | undefined): boolean {
    if (!STALE_STATUSES.includes(status)) return false
    const last = history?.[history.length - 1]?.at
    if (!last) return false
    const t = new Date(last).getTime()
    return !isNaN(t) && Date.now() - t > 7 * 86400000
  }

  const historyOf = (kind: Board, id: number): StatusEvent[] | undefined =>
    kind === 'positions'
      ? statusHistory[id]
      : kind === 'campus'
        ? campusMeta[id]?.history
        : bianzhiMeta[id]?.history

  const followInfoOf = (kind: Board, id: number) =>
    followUpInfo(
      statusOf(kind, id) === '已投递',
      historyOf(kind, id),
      followDismissed[`${kind}:${id}`],
    )

  const followUpCount = (
    board === 'positions'
      ? favorites.map((p) => p.id)
      : (board === 'campus' ? campusFavs : bianzhiFavs).map((j) => j.id)
  ).filter((id) => followInfoOf(board, id)).length

  function renderFollowUpRow(kind: Board, id: number) {
    const fu = followInfoOf(kind, id)
    if (!fu) return null
    const btnCls =
      'min-h-11 cursor-pointer rounded-md border border-amber-300 bg-background px-2 font-medium text-amber-800 transition-colors hover:bg-amber-100 sm:min-h-6 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/40'
    return (
      <div className="mt-1.5 flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        <AlarmClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{fu.days} 天未更新，是否跟进？</span>
        <button
          type="button"
          className={btnCls}
          onClick={() => (kind === 'positions' ? appendFollowUp(id) : appendBoardFollowUp(kind, id))}
        >
          已跟进
        </button>
        <button type="button" className={btnCls} onClick={() => dismissFollowUp(`${kind}:${id}`, fu.lastAt)}>
          忽略
        </button>
      </div>
    )
  }

  function renderStaleHint(status: AppStatus, history: StatusEvent[] | undefined) {
    if (!isStale(status, history)) return null
    return (
      <span
        title="该条目超过 7 天未更新状态，记得跟进下一步"
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[11px] font-medium text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" aria-hidden="true" />
        7天未更新
      </span>
    )
  }

  const FUNNEL_STAGES: { label: string; statuses: AppStatus[] }[] = [
    { label: '已投递', statuses: ['已投递'] },
    { label: '笔试/面试', statuses: ['待笔试', '待面试'] },
    { label: 'OC/录用', statuses: ['OC/录用'] },
  ]
  const stageCount = (sts: AppStatus[]) => sts.reduce((n, s) => n + (statusCounts[s] || 0), 0)
  const stageActive = (sts: AppStatus[]) =>
    !!stageFilter && stageFilter.length === sts.length && sts.every((s) => stageFilter.includes(s))

  const groups = APP_STATUSES.map((s) => {
    let items: (Position | CampusJob | BianzhiJob)[]
    if (board === 'positions') {
      items = favorites
        .filter(
          (p) =>
            statusOf('positions', p.id) === s &&
            matchPosition(p) &&
            (!followupOnly || followInfoOf('positions', p.id)),
        )
      items = sortFavs(
        items as Position[],
        (id) => !!pinnedMap[id],
        (id) => !!priorities[id],
        (p) => parseSignupDeadline(p),
      )
    } else if (board === 'campus') {
      items = sortFavs(
        campusFavs.filter(
          (j) =>
            statusOf('campus', j.id) === s &&
            matchCampus(j) &&
            (!followupOnly || followInfoOf('campus', j.id)),
        ),
        (id) => !!campusMeta[id]?.pinned,
        (id) => !!campusMeta[id]?.priority,
        (j) => getEffectiveDeadline(j),
      )
    } else {
      items = sortFavs(
        bianzhiFavs.filter(
          (j) =>
            statusOf('bianzhi', j.id) === s &&
            matchBianzhi(j) &&
            (!followupOnly || followInfoOf('bianzhi', j.id)),
        ),
        (id) => !!bianzhiMeta[id]?.pinned,
        (id) => !!bianzhiMeta[id]?.priority,
        (j) => getEffectiveDeadline(j),
      )
    }
    return { status: s, items }
  }).filter(
    (g) =>
      g.items.length > 0 &&
      (!statusFilter || g.status === statusFilter) &&
      (!stageFilter || stageFilter.includes(g.status)),
  )

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
      push(getEffectiveDeadline(j), { kind: 'campus', campus: j }, j.deadline_text)
    }
    for (const j of bianzhiFavs) {
      push(getEffectiveDeadline(j), { kind: 'bianzhi', bianzhi: j }, j.deadline_text)
    }
    return {
      calendarDays: [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime()),
      undated,
    }
  }, [favorites, campusFavs, bianzhiFavs])

  const icsEvents = useMemo(() => {
    const evts: IcsEvent[] = []
    for (const p of favorites) {
      const d = parseSignupDeadline(p)
      if (!d) continue
      evts.push({
        uid: `recruit-positions-${p.id}@jobs.zalize.com`,
        date: d,
        summary: `报名截止：${p.employer}${p.position_example ? ` ${p.position_example}` : ''}`,
        description: p.source_url || undefined,
      })
    }
    for (const j of campusFavs) {
      const d = getEffectiveDeadline(j)
      if (!d) continue
      evts.push({
        uid: `recruit-campus-${j.id}@jobs.zalize.com`,
        date: d,
        summary: `投递截止：${j.company || '未知公司'}${j.positions ? ` ${j.positions}` : ''}`,
        description: j.apply_url || j.announce_url || undefined,
      })
    }
    for (const j of bianzhiFavs) {
      const d = getEffectiveDeadline(j)
      if (!d) continue
      evts.push({
        uid: `recruit-bianzhi-${j.id}@jobs.zalize.com`,
        date: d,
        summary: `报名截止：${j.employer || '未知单位'}`,
        description: j.announce_url || j.apply_url || undefined,
      })
    }
    return evts
  }, [favorites, campusFavs, bianzhiFavs])

  // 即将截止：7 天内截止的收藏聚合（与日历红点同一数据源 calendarDays）
  const dueSoon = useMemo(() => {
    const out: { entry: CalendarEntry; daysLeft: number }[] = []
    for (const d of calendarDays) {
      const n = daysUntil(d.date)
      if (n < 0 || n > 7) continue
      for (const e of d.entries) out.push({ entry: e, daysLeft: n })
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft)
  }, [calendarDays])

  const remindDays = useRemindDays()
  const dueAlert = useMemo(() => {
    let red = 0
    let yellow = 0
    for (const d of calendarDays) {
      const n = daysUntil(d.date)
      if (n < 0) continue
      if (n <= 3) red += d.entries.length
      else if (n <= remindDays) yellow += d.entries.length
    }
    if (red > 0) return { level: 'red' as const, count: red }
    if (yellow > 0) return { level: 'yellow' as const, count: yellow }
    return null
  }, [calendarDays, remindDays])

  const firstDueRef = useRef<HTMLDivElement>(null)

  function goToFirstDue() {
    setView('calendar')
    setTimeout(() => firstDueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  const filteredCalendarDays = calendarDays
    .map((d) => ({ ...d, entries: d.entries.filter(matchEntry) }))
    .filter((d) => d.entries.length > 0)
  const filteredUndated = undated.filter((u) => matchEntry(u.entry))

  function renderTimeline(history: StatusEvent[] | undefined) {
    if (!history || history.length === 0) return null
    const fmt = (iso: string) => {
      const d = new Date(iso)
      return isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}-${d.getDate()}`
    }
    return (
      <div className="mt-1 w-full text-[11px] text-muted-foreground">
        {history
          .slice(-4)
          .map((e) => `${fmt(e.at)} ${e.status}`.trim())
          .join(' → ')}
      </div>
    )
  }

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
        {renderTimeline(meta?.history)}
        {renderFollowUpRow(kind, id)}
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
          aria-label="投递状态"
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
        <div className="flex items-start gap-2 max-sm:flex-wrap">
          {renderCompareCheck('campus', j.id)}
          <div
            className={cn(
              'min-w-0 flex-1 cursor-pointer',
              compareMode ? 'max-sm:w-auto max-sm:flex-1' : 'max-sm:w-full max-sm:flex-none',
            )}
            onClick={() => (compareMode ? toggleCompareSel('campus', j.id) : setCampusDetail(j))}
          >
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
              {j.deadline_text && <span>截止：{normalizeDateStr(j.deadline_text)}</span>}
              {j.apply_url && j.apply_url.startsWith('http') && (
                <a
                  href={j.apply_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  投递链接 <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          {renderStaleHint(statusOf('campus', j.id), campusMeta[j.id]?.history)}
          {renderStatusSelect('campus', j.id)}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={campusMeta[j.id]?.pinned ? '取消置顶' : '置顶'}
            aria-pressed={!!campusMeta[j.id]?.pinned}
            onClick={() => toggleBoardPinned('campus', j.id)}
          >
            <Pin
              className={cn(
                'h-4 w-4',
                campusMeta[j.id]?.pinned ? 'fill-primary text-primary' : 'text-muted-foreground',
              )}
            />
          </Button>
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
        <div className="flex items-start gap-2 max-sm:flex-wrap">
          {renderCompareCheck('bianzhi', j.id)}
          <div
            className={cn(
              'min-w-0 flex-1 cursor-pointer',
              compareMode ? 'max-sm:w-auto max-sm:flex-1' : 'max-sm:w-full max-sm:flex-none',
            )}
            onClick={() => (compareMode ? toggleCompareSel('bianzhi', j.id) : setBianzhiDetail(j))}
          >
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
              {j.deadline_text && <span>截止：{normalizeDateStr(j.deadline_text)}</span>}
              {j.announce_url && j.announce_url.startsWith('http') && (
                <a
                  href={j.announce_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  公告链接 <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          {renderStaleHint(statusOf('bianzhi', j.id), bianzhiMeta[j.id]?.history)}
          {renderStatusSelect('bianzhi', j.id)}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={bianzhiMeta[j.id]?.pinned ? '取消置顶' : '置顶'}
            aria-pressed={!!bianzhiMeta[j.id]?.pinned}
            onClick={() => toggleBoardPinned('bianzhi', j.id)}
          >
            <Pin
              className={cn(
                'h-4 w-4',
                bianzhiMeta[j.id]?.pinned ? 'fill-primary text-primary' : 'text-muted-foreground',
              )}
            />
          </Button>
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
      <div className="flex items-start gap-2 max-sm:flex-wrap">
        {renderCompareCheck('positions', p.id)}
        <button
          type="button"
          className={cn(
            'min-w-0 flex-1 text-left',
            compareMode ? 'max-sm:w-auto max-sm:flex-1' : 'max-sm:w-full max-sm:flex-none',
          )}
          onClick={() => (compareMode ? toggleCompareSel('positions', p.id) : setSelected(p))}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-[11px]">
              {p.year}
            </Badge>
            <span className="line-clamp-1 text-sm font-medium">
              {(p.position_example && stripOrgPrefix(p.position_example, p.employer)) ||
                p.exam_type ||
                '-'}
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
        {renderStaleHint(statusOf('positions', p.id), statusHistory[p.id])}
        {renderStatusSelect('positions', p.id)}
        <CompareButton item={p} />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={pinnedMap[p.id] ? '取消置顶' : '置顶'}
          aria-pressed={!!pinnedMap[p.id]}
          onClick={() => toggleAppPinned(p.id)}
        >
          <Pin
            className={cn(
              'h-4 w-4',
              pinnedMap[p.id] ? 'fill-primary text-primary' : 'text-muted-foreground',
            )}
          />
        </Button>
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
            aria-label="投递渠道"
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
        {renderTimeline(statusHistory[p.id])}
        {renderFollowUpRow('positions', p.id)}
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

  async function copyFavoritesList() {
    const lines: string[] = []
    const join = (parts: (string | null | undefined)[]) =>
      parts.map((s) => (s || '').trim()).filter(Boolean).join(' - ')
    if (board === 'positions') {
      for (const p of favorites) {
        lines.push(join([p.employer, p.position_example, p.signup_time, p.source_url]))
      }
    } else if (board === 'campus') {
      for (const j of campusFavs) {
        lines.push(
          join([j.company, j.positions, j.deadline_text, j.apply_url || j.announce_url]),
        )
      }
    } else {
      for (const j of bianzhiFavs) {
        lines.push(
          join([j.employer, j.job_type, j.deadline_text, j.announce_url || j.apply_url]),
        )
      }
    }
    await copyText(lines.filter(Boolean).join('\n'))
    setListCopied(true)
    setTimeout(() => setListCopied(false), 2000)
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

  function handleRestoreFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const r = restoreBackup(String(reader.result))
        setRestoreMsg({
          ok: true,
          text: `已恢复：体制内 ${r.positions} · 校招 ${r.campus} · 编制 ${r.bianzhi}（新增 ${r.added} · 更新 ${r.updated}）`,
        })
      } catch (e) {
        setRestoreMsg({ ok: false, text: e instanceof Error ? e.message : '恢复失败' })
      }
    }
    reader.onerror = () => setRestoreMsg({ ok: false, text: '文件读取失败' })
    reader.readAsText(file)
  }

  const BOARD_TABS: { key: Board; label: string; count: number }[] = [
    { key: 'positions', label: '体制内', count: favorites.length },
    { key: 'campus', label: '校招', count: campusFavs.length },
    { key: 'bianzhi', label: '编制', count: bianzhiFavs.length },
  ]

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full max-w-2xl p-0 data-[side=right]:w-full sm:max-w-md">
          <SheetHeader className="space-y-1.5 px-4 pt-6 sm:px-6">
            <SheetTitle className="flex items-center gap-2 pr-8 text-lg">
              <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
              我的收藏
              <Badge variant="secondary">{totalCount}</Badge>
            </SheetTitle>
            <div className="flex flex-wrap items-center gap-1">
              {onOpenHistory && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-11 text-xs text-muted-foreground sm:h-7 sm:min-h-0"
                  onClick={onOpenHistory}
                >
                  <HistoryIcon className="mr-1 h-3.5 w-3.5" />
                  最近浏览
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={digestOpen}
                className="h-auto min-h-11 text-xs text-muted-foreground sm:h-7 sm:min-h-0"
                onClick={() => setDigestOpen((v) => !v)}
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                本周小结
              </Button>
              {boardCount > 0 && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto min-h-11 text-xs text-muted-foreground sm:h-7 sm:min-h-0"
                    onClick={exportCsv}
                    disabled={exportCount === 0}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    {q ? `导出 CSV (${exportCount})` : '导出 CSV'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto min-h-11 text-xs text-muted-foreground sm:h-7 sm:min-h-0"
                    onClick={copyFavoritesList}
                    disabled={boardCount === 0}
                  >
                    {listCopied ? (
                      <>
                        <Check className="mr-1 h-3.5 w-3.5 text-green-600" />
                        已复制
                      </>
                    ) : (
                      <>
                        <ClipboardList className="mr-1 h-3.5 w-3.5" />
                        复制收藏清单
                      </>
                    )}
                  </Button>
                  {board === 'positions' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto min-h-11 text-xs text-muted-foreground sm:h-7 sm:min-h-0"
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
                  )}
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto min-h-11 text-xs text-muted-foreground sm:h-7 sm:min-h-0"
                    >
                      <MoreHorizontal className="mr-1 h-3.5 w-3.5" />
                      更多
                    </Button>
                  }
                />
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={downloadBackup} disabled={totalCount === 0}>
                    <DatabaseBackup className="mr-1.5 h-3.5 w-3.5" />
                    备份数据
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                    <FileUp className="mr-1.5 h-3.5 w-3.5" />
                    恢复备份
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSyncOpen(true)}>
                    <MonitorSmartphone className="mr-1.5 h-3.5 w-3.5" />
                    多设备同步码
                  </DropdownMenuItem>
                  {board === 'positions' && boardCount > 0 && (
                    <DropdownMenuItem onClick={clearFavorites}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      清空收藏
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleRestoreFile(f)
                  e.target.value = ''
                }}
              />
            </div>
            {restoreMsg && (
              <p
                className={cn(
                  'text-xs',
                  restoreMsg.ok
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400',
                )}
              >
                {restoreMsg.text}
              </p>
            )}
          </SheetHeader>
          <div className="space-y-2 px-4 pb-1 sm:px-6">
            {digestOpen && <WeeklyDigest onClose={() => setDigestOpen(false)} />}
            {syncOpen && <SyncCodePanel onClose={() => setSyncOpen(false)} />}
            {dueAlert && (
              <button
                type="button"
                onClick={goToFirstDue}
                className={cn(
                  'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium sm:min-h-0',
                  dueAlert.level === 'red'
                    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300'
                    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
                )}
              >
                <AlarmClock className="h-4 w-4 shrink-0" />
                {dueAlert.count} 条收藏{dueAlert.level === 'red' ? ' 3 天内截止' : `将于 ${remindDays} 天内截止`}，点击查看
              </button>
            )}
            <button
              type="button"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((v) => !v)}
              className="flex min-h-11 w-full cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground sm:hidden"
            >
              <AlarmClock className="h-3.5 w-3.5 shrink-0" />
              提醒与通知设置
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', settingsOpen && 'rotate-180')} />
            </button>
            <div className={cn('space-y-2', !settingsOpen && 'hidden sm:block sm:space-y-2')}>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <AlarmClock className="h-3.5 w-3.5 shrink-0" />
              提前提醒
              {REMIND_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={remindDays === n}
                  onClick={() => setRemindDays(n)}
                  className={cn(
                    'min-h-11 min-w-11 cursor-pointer rounded-full border px-2.5 py-0.5 transition-colors sm:min-h-6 sm:min-w-0',
                    remindDays === n
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {n} 天
                </button>
              ))}
              <span className="hidden sm:inline">顶栏红点与横幅按此计算</span>
            </div>
            <NotifyToggleRow />
            <PushToggleRow />
            <NewsNotifyToggleRow />
            <ExtLinkConfirmToggleRow />
            </div>
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
                  {t.count > 0 && <span className="ml-1">{t.count}</span>}
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
                  className="h-auto min-h-11 gap-1 text-xs sm:h-7 sm:min-h-0"
                  onClick={() => setView('track')}
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  投递追踪
                </Button>
                <Button
                  variant={view === 'calendar' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-auto min-h-11 gap-1 text-xs sm:h-7 sm:min-h-0"
                  onClick={() => setView('calendar')}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  截止日历
                </Button>
                {view === 'track' && (
                  <Button
                    variant={compareMode ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-pressed={compareMode}
                    className="h-auto min-h-11 gap-1 text-xs sm:h-7 sm:min-h-0"
                    onClick={() => (compareMode ? exitCompare() : setCompareMode(true))}
                  >
                    <Scale className="h-3.5 w-3.5" />
                    对比
                  </Button>
                )}
              </div>
            )}
            {boardCount > 0 && view === 'track' && (
              <div className="scrollbar-none -mx-1 flex items-center gap-1 overflow-x-auto px-1 text-[11px]">
                <button
                  type="button"
                  aria-pressed={!stageFilter && !statusFilter}
                  className={cn(
                    'flex min-h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 font-medium transition-colors sm:min-h-0',
                    !stageFilter && !statusFilter
                      ? 'border-primary/40 bg-primary/5 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted',
                  )}
                  onClick={() => {
                    setStageFilter(null)
                    setStatusFilter(null)
                    setFollowupOnly(false)
                  }}
                >
                  收藏 <span className="font-semibold">{boardCount}</span>
                </button>
                {FUNNEL_STAGES.map((st) => (
                  <span key={st.label} className="flex shrink-0 items-center gap-1">
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                    <button
                      type="button"
                      aria-pressed={stageActive(st.statuses)}
                      className={cn(
                        'flex min-h-9 cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 font-medium transition-colors sm:min-h-0',
                        stageActive(st.statuses)
                          ? 'border-primary/40 bg-primary/5 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted',
                      )}
                      onClick={() => {
                        setStatusFilter(null)
                        setFollowupOnly(false)
                        setStageFilter((cur) => (stageActive(st.statuses) && cur ? null : st.statuses))
                      }}
                    >
                      {st.label} <span className="font-semibold">{stageCount(st.statuses)}</span>
                    </button>
                  </span>
                ))}
                {followUpCount > 0 && (
                  <button
                    type="button"
                    aria-pressed={followupOnly}
                    className={cn(
                      'ml-1 flex min-h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 font-medium transition-colors sm:min-h-0',
                      followupOnly
                        ? 'border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'border-amber-300 bg-background text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/40',
                    )}
                    onClick={() => {
                      setStatusFilter(null)
                      setStageFilter(null)
                      setFollowupOnly((v) => !v)
                    }}
                  >
                    <AlarmClock className="h-3 w-3" aria-hidden="true" />
                    需跟进 <span className="font-semibold">{followUpCount}</span>
                  </button>
                )}
              </div>
            )}
            {boardCount > 0 && view === 'track' && (
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-muted-foreground">排序</span>
                {(
                  [
                    ['added', '按加入时间'],
                    ['deadline', '按截止日'],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={sortMode === m}
                    className={cn(
                      'min-h-9 cursor-pointer rounded-full px-2 py-0.5 font-medium transition-colors sm:min-h-0',
                      sortMode === m
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70',
                    )}
                    onClick={() => changeSortMode(m)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {boardCount > 0 && view === 'track' && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  aria-pressed={statusFilter === null}
                  className={`cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-medium transition-shadow ${
                    statusFilter === null
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary/50'
                      : 'bg-muted text-muted-foreground'
                  }`}
                  onClick={() => {
                    setStatusFilter(null)
                    setStageFilter(null)
                    setFollowupOnly(false)
                  }}
                >
                  全部 {boardCount}
                </button>
                {APP_STATUSES.filter((s) => statusCounts[s]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={statusFilter === s}
                    className={`cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-medium transition-shadow ${STATUS_COLORS[s]} ${
                      statusFilter === s ? 'ring-2 ring-primary/50' : statusFilter ? 'opacity-50' : ''
                    }`}
                    onClick={() => {
                      setStageFilter(null)
                      setStatusFilter((cur) => (cur === s ? null : s))
                    }}
                  >
                    {s} <span data-count>{statusCounts[s]}</span>
                  </button>
                ))}
                {statusFilter && (
                  <button
                    type="button"
                    className="cursor-pointer rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      setStatusFilter(null)
                      setStageFilter(null)
                    }}
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {view === 'track' ? (
              <div>
                {dueSoon.length > 0 && (
                  <div>
                    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-popover px-4 py-1.5 sm:px-6">
                      <AlarmClock className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
                      <span className="text-xs font-semibold">即将截止（7 天内）</span>
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                        {dueSoon.length} 条
                      </span>
                    </div>
                    <div className="divide-y">
                      {dueSoon.map(({ entry: e, daysLeft }) => {
                        const item = (e.position ?? e.campus ?? e.bianzhi)!
                        const title =
                          e.kind === 'positions'
                            ? e.position!.employer?.trim() || e.position!.position_example || '体制内岗位'
                            : e.kind === 'campus'
                              ? [e.campus!.company, e.campus!.positions].filter(Boolean).join(' · ') || '校招岗位'
                              : e.bianzhi!.employer || e.bianzhi!.job_type || '编制公告'
                        return (
                          <button
                            key={`due-${e.kind}-${item.id}`}
                            type="button"
                            className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/60 sm:px-6"
                            onClick={() => {
                              if (e.kind === 'positions') setSelected(e.position!)
                              else if (e.kind === 'campus') setCampusDetail(e.campus!)
                              else setBianzhiDetail(e.bianzhi!)
                            }}
                          >
                            <span className={cn(PILL_BASE, 'shrink-0 bg-muted/60 text-muted-foreground')}>
                              {e.kind === 'positions' ? '体制内' : e.kind === 'campus' ? '校招' : '编制'}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                daysLeft <= 1
                                  ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                                  : daysLeft <= 3
                                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                              }`}
                            >
                              {daysLeft === 0 ? '今日截止' : `剩 ${daysLeft} 天`}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {boardCount === 0 ? (
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
                  description="点击列表里的星标即可收藏，之后在这里管理投递全流程"
                  action={
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/10">
                          <Star className="h-4 w-4 text-amber-500" />
                        </span>
                        <ArrowRight className="h-3.5 w-3.5" />
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                          <ClipboardList className="h-4 w-4 text-primary" />
                        </span>
                        <ArrowRight className="h-3.5 w-3.5" />
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10">
                          <AlarmClock className="h-4 w-4 text-red-500" />
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        星标收藏 → 投递状态追踪 → 截止自动提醒
                      </div>
                    </div>
                  }
                />
              ) : (
                <>
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
                </>
              )}
              </div>
            ) : (
              <div className="space-y-1 pb-4">
                <div className="flex items-center justify-end px-4 pt-2 sm:px-6">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 gap-1 text-xs sm:h-7"
                    disabled={icsEvents.length === 0}
                    onClick={() =>
                      downloadIcs(icsEvents, `上岸罗盘截止日历_${new Date().toISOString().slice(0, 10)}.ics`)
                    }
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    导出到日历 (.ics{icsEvents.length ? ` · ${icsEvents.length}` : ''})
                  </Button>
                </div>
                {filteredCalendarDays.map(({ date, entries }, idx) => {
                  const n = daysUntil(date)
                  const expired = n < 0
                  const firstDueIdx = filteredCalendarDays.findIndex((d) => daysUntil(d.date) >= 0)
                  return (
                    <div
                      key={date.toDateString()}
                      ref={idx === firstDueIdx ? firstDueRef : undefined}
                      className={expired ? 'opacity-50' : undefined}
                    >
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
          {compareMode && (
            <div className="shrink-0 border-t bg-background/95 px-4 py-2.5 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] backdrop-blur sm:px-6">
              {compareHint && (
                <p className="mb-1.5 text-xs text-amber-600 dark:text-amber-400">{compareHint}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Scale className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-sm font-medium">已选 {compareSel.length}/3</span>
                <span className="text-xs text-muted-foreground">勾选同板块 2-3 条收藏</span>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto min-h-11 text-xs text-muted-foreground sm:h-8 sm:min-h-0"
                    onClick={exitCompare}
                  >
                    退出对比
                  </Button>
                  <Button
                    size="sm"
                    className="h-auto min-h-11 text-xs sm:h-8 sm:min-h-0"
                    disabled={compareSel.length < 2}
                    onClick={() => setCompareOpen(true)}
                  >
                    开始对比{compareSel.length < 2 ? '（至少 2 条）' : ''}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <FavCompareDialog
        open={compareOpen && compareColumns.length >= 2}
        onClose={() => setCompareOpen(false)}
        columns={compareColumns}
      />
      {selected && (
        <LazyPositionSheet item={selected} onClose={() => setSelected(null)} snapshotNote />
      )}
      {campusDetail && (
        <BoardJobSheet
          open={!!campusDetail}
          onClose={() => setCampusDetail(null)}
          title={campusDetail.company || '-'}
          badges={[campusDetail.company_type, campusDetail.source_table].filter(
            (b): b is string => !!b,
          )}
          shareText={buildShareText({
            org: campusDetail.company,
            title: campusDetail.positions,
            location: campusDetail.locations,
            deadline: campusDetail.deadline_text,
            deepLink: jobShareUrl('campus', campusDetail.id),
            url: campusDetail.announce_url || campusDetail.apply_url,
          })}
          favActive={campusFavs.some((f) => f.id === campusDetail.id)}
          onFavToggle={() => toggleCampusFavorite(campusDetail)}
          snapshotNote
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
            { label: '开始时间', value: normalizeDateStr(campusDetail.start_date) },
            { label: '截止时间', value: normalizeDateStr(campusDetail.deadline_text) },
            { label: '更新时间', value: normalizeDateStr(campusDetail.updated_at_src) },
          ]}
          links={[
            { label: '投递入口', url: campusDetail.apply_url, checkDead: true },
            { label: '公告链接', url: campusDetail.announce_url },
          ]}
        />
      )}
      {bianzhiDetail && (
        <BoardJobSheet
          open={!!bianzhiDetail}
          onClose={() => setBianzhiDetail(null)}
          title={
            bianzhiDetail.employer ||
            (bianzhiDetail.category === '大型联考'
              ? `${bianzhiDetail.province ?? ''}${bianzhiDetail.job_type ?? ''}联考`
              : '-')
          }
          badges={[bianzhiDetail.category, bianzhiDetail.province].filter(
            (b): b is string => !!b,
          )}
          shareText={buildShareText({
            org:
              bianzhiDetail.employer ||
              (bianzhiDetail.category === '大型联考'
                ? `${bianzhiDetail.province ?? ''}${bianzhiDetail.job_type ?? ''}联考`
                : null),
            title: bianzhiDetail.job_type,
            location: bianzhiDetail.work_location || bianzhiDetail.province,
            deadline: bianzhiDetail.deadline_text || bianzhiDetail.deadline_date,
            deepLink: jobShareUrl('bianzhi', bianzhiDetail.id),
            url: bianzhiDetail.announce_url || bianzhiDetail.apply_url,
          })}
          favActive={bianzhiFavs.some((f) => f.id === bianzhiDetail.id)}
          onFavToggle={() => toggleBianzhiFavorite(bianzhiDetail)}
          snapshotNote
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
            { label: '报名开始', value: normalizeDateStr(bianzhiDetail.signup_start) },
            { label: '报名截止', value: normalizeDateStr(bianzhiDetail.deadline_text) },
            { label: '考试时间', value: bianzhiDetail.exam_time },
            { label: '更新时间', value: normalizeDateStr(bianzhiDetail.updated_at_src) },
          ]}
          links={[
            { label: '公告链接', url: bianzhiDetail.announce_url, checkDead: true },
            { label: '报名入口', url: bianzhiDetail.apply_url, checkDead: true },
          ]}
        />
      )}
    </>
  )
}

/** 「外链打开前确认」开关（默认关：直接跳转）：开启后详情内外链点击先弹安全确认层。 */
function ExtLinkConfirmToggleRow() {
  const enabled = useConfirmExtLink()
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
      外链打开前确认
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="外链打开前确认"
        onClick={() => setConfirmExtLink(!enabled)}
        className="relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center sm:h-6 sm:w-10"
      >
        <span
          className={cn(
            'inline-flex h-5 w-9 items-center rounded-full border px-0.5 transition-colors',
            enabled ? 'border-primary bg-primary' : 'border-border bg-muted',
          )}
        >
          <span
            className={cn(
              'h-4 w-4 rounded-full bg-background shadow transition-transform',
              enabled ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </span>
      </button>
      <span className="hidden sm:inline">
        {enabled ? '点击详情外链时先确认目标网站' : '默认直接跳转，详情内已显示链接域名'}
      </span>
    </div>
  )
}

/** 「关站推送提醒」开关（默认关）：Web Push 订阅，即使没打开站点也能收到每日临近截止聚合推送。 */
function PushToggleRow() {
  const enabled = usePushEnabled()
  const favorites = useFavorites()
  const campusFavs = useCampusFavorites()
  const bianzhiFavs = useBianzhiFavorites()
  const remindDays = useRemindDays()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!isPushSupported()) return null

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (enabled) {
        await disablePush()
        return
      }
      const items = buildPushItems(favorites, campusFavs, bianzhiFavs)
      const result = await enablePush(remindDays, items)
      if (result === 'denied') setError('浏览器已拒绝通知权限（可在地址栏站点设置中重新允许）')
      else if (result === 'unconfigured') setError('推送服务暂未配置，请稍后再试')
      else if (result !== 'granted') setError('开启失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <MonitorSmartphone className="h-3.5 w-3.5 shrink-0" />
      关站推送提醒
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="关站推送提醒"
        aria-busy={busy}
        onClick={toggle}
        className="relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center sm:h-6 sm:w-10"
      >
        <span
          className={cn(
            'inline-flex h-5 w-9 items-center rounded-full border px-0.5 transition-colors',
            enabled ? 'border-primary bg-primary' : 'border-border bg-muted',
          )}
        >
          <span
            className={cn(
              'h-4 w-4 rounded-full bg-background shadow transition-transform',
              enabled ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </span>
      </button>
      <span className="hidden sm:inline">
        {enabled ? '不打开站点也会在每天早上推送临近截止的收藏' : '默认关闭，开启后关站也能收到截止推送'}
      </span>
      {error && <span className="w-full text-amber-700 dark:text-amber-300">{error}</span>}
    </div>
  )
}

/** 「订阅上新浏览器通知」独立开关（默认关）：常用筛选检测到新增时每日至多一条聚合通知，无权限回退红点。 */
function NewsNotifyToggleRow() {
  const enabled = useNewsNotifyEnabled()
  const [denied, setDenied] = useState(false)
  if (!isNotificationSupported()) return null

  const toggle = async () => {
    if (enabled) {
      setNewsNotifyEnabled(false)
      return
    }
    const perm = await enableNewsNotification()
    setDenied(perm !== 'granted')
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Bookmark className="h-3.5 w-3.5 shrink-0" />
      订阅上新浏览器通知
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="订阅上新浏览器通知"
        onClick={toggle}
        className={cn(
          'relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center sm:h-6 sm:w-10',
        )}
      >
        <span
          className={cn(
            'inline-flex h-5 w-9 items-center rounded-full border px-0.5 transition-colors',
            enabled ? 'border-primary bg-primary' : 'border-border bg-muted',
          )}
        >
          <span
            className={cn(
              'h-4 w-4 rounded-full bg-background shadow transition-transform',
              enabled ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </span>
      </button>
      <span className="hidden sm:inline">
        {enabled ? '常用筛选有上新时每日至多提醒一条' : '默认关闭，仅用站内红点提示上新'}
      </span>
      {denied && (
        <span className="w-full text-amber-700 dark:text-amber-300">
          浏览器已拒绝通知权限（可在地址栏站点设置中重新允许），已回退为站内红点提示
        </span>
      )}
    </div>
  )
}

/** 「截止提醒浏览器通知」开关（默认关）：开启时请求 Notification 权限，被拒提示并回退站内红点。 */
function NotifyToggleRow() {
  const enabled = useNotifyEnabled()
  const [denied, setDenied] = useState(false)
  if (!isNotificationSupported()) return null

  const toggle = async () => {
    if (enabled) {
      setNotifyEnabled(false)
      return
    }
    const perm = await enableDueNotification()
    setDenied(perm !== 'granted')
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <AlarmClock className="h-3.5 w-3.5 shrink-0" />
      截止提醒浏览器通知
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="截止提醒浏览器通知"
        onClick={toggle}
        className={cn(
          'relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center sm:h-6 sm:w-10',
        )}
      >
        <span
          className={cn(
            'inline-flex h-5 w-9 items-center rounded-full border px-0.5 transition-colors',
            enabled ? 'border-primary bg-primary' : 'border-border bg-muted',
          )}
        >
          <span
            className={cn(
              'h-4 w-4 rounded-full bg-background shadow transition-transform',
              enabled ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </span>
      </button>
      <span className="hidden sm:inline">
        {enabled ? '打开站点时若有临近截止的收藏，每日至多提醒一条' : '默认关闭，仅用站内红点提醒'}
      </span>
      {denied && (
        <span className="w-full text-amber-700 dark:text-amber-300">
          浏览器已拒绝通知权限（可在地址栏站点设置中重新允许），已回退为站内红点提醒
        </span>
      )}
    </div>
  )
}
