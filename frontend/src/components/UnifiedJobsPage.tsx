import { t, tt } from '@/lib/i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  fetchBianzhiJob,
  fetchCampusJob,
  fetchPosition,
  fetchUnifiedJobFilters,
  fetchUnifiedJobs,
  type BianzhiJob,
  type CampusJob,
  type Position,
  type UnifiedJob,
  type UnifiedJobFilters,
  type UnifiedJobParams,
} from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { Highlight } from '@/components/Highlight'
import { DueBadge } from '@/components/DueBadge'
import { MultiSelect } from '@/components/MultiSelect'
import { MobileFilterCollapse } from '@/components/MobileFilterCollapse'
import { BoardJobSheet } from '@/components/BoardJobSheet'
import { LazyPositionSheet } from '@/components/LazyPositionSheet'
import { buildShareText } from '@/components/ShareTextButton'
import { jobShareUrl } from '@/lib/clipboard'
import { normalizeDateStr } from '@/lib/tableSort'
import {
  toggleBianzhiFavorite,
  toggleCampusFavorite,
  useBianzhiFavorites,
  useCampusFavorites,
} from '@/lib/boardFavorites'
import { TONE_CLASSES, hashTone, type Tone } from '@/lib/badgeColors'
import { cn } from '@/lib/utils'
import {
  Building2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GraduationCap,
  LayoutGrid,
  Loader2,
  MapPin,
  Search,
  Table2,
  X,
} from 'lucide-react'

const BOARD_TONES: Record<string, Tone> = {
  体制内: 'blue',
  校招: 'green',
  编制: 'violet',
}

const BOARD_DOTS: Record<string, string> = {
  体制内: 'bg-blue-500',
  校招: 'bg-green-500',
  编制: 'bg-violet-500',
}

const EDU_LEVELS = ['博士研究生', '硕士研究生', '本科', '大专/中专', '其他/不限']

const PAGE_SIZE = 50
const ROW_ESTIMATE = 96

type SortKey = 'recommended' | 'created_desc' | 'deadline_asc'

function boardToneClass(board: string): string {
  return TONE_CLASSES[BOARD_TONES[board] || hashTone(board)]
}

function readUrlState() {
  const q = new URLSearchParams(window.location.search)
  const csv = (k: string) => (q.get(k) || '').split(',').filter(Boolean)
  const rawSort = q.get('ajsort')
  return {
    keyword: q.get('ajkw') || '',
    boards: csv('ajb'),
    provinces: csv('ajp'),
    cities: csv('ajc'),
    edus: csv('aje'),
    due: q.get('ajdue') || '',
    hideExpired: q.get('ajhexp') === '1',
    sort: (rawSort === 'deadline_asc' || rawSort === 'created_desc'
      ? rawSort
      : 'recommended') as SortKey,
    view: (q.get('ajview') === 'table' ? 'table' : 'card') as 'card' | 'table',
  }
}

/** 同板块 + 相同岗位名 + 相同单位的相邻多城市行折叠为一组 */
interface JobRow {
  job: UnifiedJob
  groupKey: string | null
  groupCount: number
  cities: string[]
}

function groupKeyOf(j: UnifiedJob): string | null {
  if (!j.title || !j.employer) return null
  return `${j.source_board}|${j.title}|${j.employer}`
}

function locationOf(j: UnifiedJob): string {
  return j.city || j.province || j.work_location || ''
}

function buildRows(items: UnifiedJob[], expanded: Set<string>): JobRow[] {
  const rows: JobRow[] = []
  let i = 0
  while (i < items.length) {
    const key = groupKeyOf(items[i])
    let j = i + 1
    while (j < items.length && key !== null && groupKeyOf(items[j]) === key) j++
    const run = items.slice(i, j)
    if (run.length > 1 && key !== null && !expanded.has(key)) {
      const cities = [...new Set(run.map(locationOf).filter(Boolean))]
      rows.push({ job: run[0], groupKey: key, groupCount: run.length, cities })
    } else {
      for (const job of run) rows.push({ job, groupKey: null, groupCount: 1, cities: [] })
    }
    i = j
  }
  return rows
}

export function UnifiedJobsPage() {
  const init = useMemo(readUrlState, [])
  const [keywordInput, setKeywordInput] = useState(init.keyword)
  const [keyword, setKeyword] = useState(init.keyword)
  const [boards, setBoards] = useState<string[]>(init.boards)
  const [provinces, setProvinces] = useState<string[]>(init.provinces)
  const [cities, setCities] = useState<string[]>(init.cities)
  const [edus, setEdus] = useState<string[]>(init.edus)
  const [due, setDue] = useState(init.due)
  const [hideExpired, setHideExpired] = useState(init.hideExpired)
  const [sort, setSort] = useState<SortKey>(init.sort)
  const [view, setView] = useState<'card' | 'table'>(init.view)
  const [filters, setFilters] = useState<UnifiedJobFilters | null>(null)

  const [items, setItems] = useState<UnifiedJob[]>([])
  const [total, setTotal] = useState(0)
  const [totalCapped, setTotalCapped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [exhausted, setExhausted] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [positionDetail, setPositionDetail] = useState<Position | null>(null)
  const [campusDetail, setCampusDetail] = useState<CampusJob | null>(null)
  const [bianzhiDetail, setBianzhiDetail] = useState<BianzhiJob | null>(null)
  const campusFavs = useCampusFavorites()
  const bianzhiFavs = useBianzhiFavorites()
  const abortRef = useRef<AbortController | null>(null)
  const parentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchUnifiedJobFilters().then((f) => f && setFilters(f))
  }, [])

  // 关键词输入 500ms 防抖自动搜索（回车立即搜索）
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordInput.trim()), 500)
    return () => clearTimeout(timer)
  }, [keywordInput])

  // URL 深链持久化（ajb/ajp/ajc/aje/ajkw/ajdue/ajhexp/ajsort/ajview）
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const setOrDel = (k: string, v: string) => (v ? q.set(k, v) : q.delete(k))
    setOrDel('ajkw', keyword)
    setOrDel('ajb', boards.join(','))
    setOrDel('ajp', provinces.join(','))
    setOrDel('ajc', cities.join(','))
    setOrDel('aje', edus.join(','))
    setOrDel('ajdue', due)
    setOrDel('ajhexp', hideExpired ? '1' : '')
    setOrDel('ajsort', sort === 'recommended' ? '' : sort)
    setOrDel('ajview', view === 'table' ? view : '')
    window.history.replaceState(null, '', `?${q.toString()}${window.location.hash}`)
  }, [keyword, boards, provinces, cities, edus, due, hideExpired, sort, view])

  const params = useMemo<UnifiedJobParams>(
    () => ({
      keyword: keyword || undefined,
      board: boards.length ? boards : undefined,
      province: provinces.length ? provinces : undefined,
      city: cities.length ? cities : undefined,
      edu: edus.length ? edus : undefined,
      due_within_days: due ? Number(due) : undefined,
      hide_expired: hideExpired || undefined,
      sort,
    }),
    [keyword, boards, provinces, cities, edus, due, hideExpired, sort],
  )

  const loadPage = useCallback(
    async (page: number) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      try {
        const res = await fetchUnifiedJobs({ ...params, page, page_size: PAGE_SIZE }, controller.signal)
        if (controller.signal.aborted) return
        setTotal(res.total)
        setTotalCapped(!!res.total_capped)
        if (res.items.length < PAGE_SIZE) setExhausted(true)
        setItems((prev) => {
          if (page === 1) return res.items
          const seen = new Set(prev.map((p) => `${p.source_board}:${p.source_id}`))
          const fresh = res.items.filter((p) => !seen.has(`${p.source_board}:${p.source_id}`))
          if (fresh.length === 0) setExhausted(true)
          return [...prev, ...fresh]
        })
      } catch (e) {
        if (!controller.signal.aborted) console.error(e)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [params],
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      setItems([])
      setTotal(0)
      setTotalCapped(false)
      setExhausted(false)
      setExpandedGroups(new Set())
      parentRef.current?.scrollTo({ top: 0 })
      loadPage(1)
    }, 250)
    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [loadPage])

  const rows = useMemo(() => buildRows(items, expandedGroups), [items, expandedGroups])
  const hasMore = !exhausted && items.length < total

  const virtualizer = useVirtualizer({
    count: hasMore ? rows.length + 1 : rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (view === 'table' ? 52 : ROW_ESTIMATE),
    overscan: 8,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1]
    if (!last) return
    if (last.index >= rows.length - 1 && hasMore && !loading && items.length > 0) {
      loadPage(Math.floor(items.length / PAGE_SIZE) + 1)
    }
  }, [virtualItems, rows, items, hasMore, loading, loadPage])

  const toggleBoard = (b: string) =>
    setBoards((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]))

  const provinceOptions = useMemo(
    () => (filters ? Object.keys(filters.provinces) : []),
    [filters],
  )
  const cityOptions = useMemo(
    () => (filters ? Object.keys(filters.cities) : []),
    [filters],
  )

  const activeCount =
    boards.length + provinces.length + cities.length + edus.length +
    (keyword ? 1 : 0) + (due ? 1 : 0) + (hideExpired ? 1 : 0)

  const resetAll = () => {
    setKeywordInput('')
    setKeyword('')
    setBoards([])
    setProvinces([])
    setCities([])
    setEdus([])
    setDue('')
    setHideExpired(false)
  }

  // 计数口径：total 被截断且无筛选时，用板块合计的精确总数
  const boardsSum = useMemo(
    () => (filters ? Object.values(filters.boards).reduce((a, b) => a + b, 0) : 0),
    [filters],
  )
  const showPrecise = totalCapped && activeCount === 0 && boardsSum > 0
  const displayTotal = showPrecise ? boardsSum : total
  const displayCapped = totalCapped && !showPrecise

  // 详情面板在本页内打开（不切换板块、不改 board URL 参数）
  const openJob = (job: UnifiedJob) => {
    const fallback = () => {
      const url = job.announce_url || job.apply_url
      if (url) window.open(url, '_blank', 'noopener')
    }
    if (job.source_board === '体制内') {
      fetchPosition(job.source_id).then(setPositionDetail).catch(fallback)
    } else if (job.source_board === '校招') {
      fetchCampusJob(job.source_id).then(setCampusDetail).catch(fallback)
    } else {
      fetchBianzhiJob(job.source_id).then(setBianzhiDetail).catch(fallback)
    }
  }

  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

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
      org: j.employer,
      title: j.job_type,
      location: j.work_location || j.province,
      deadline: j.deadline_text || j.deadline_date,
      deepLink: jobShareUrl('bianzhi', j.id),
      url: j.announce_url || j.apply_url,
    })

  const boardChips = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{t('板块')}</span>
      {(['体制内', '校招', '编制'] as const).map((b) => {
        const active = boards.length === 0 || boards.includes(b)
        const selected = boards.includes(b)
        return (
          <button
            key={b}
            type="button"
            aria-pressed={selected}
            onClick={() => toggleBoard(b)}
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors',
              selected
                ? 'border-primary/40 bg-primary/10 text-primary'
                : active
                  ? 'bg-background text-foreground hover:bg-muted'
                  : 'bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', BOARD_DOTS[b])} />
            {t(b)}
            {filters?.boards[b] != null && (
              <span className="text-[10px] text-muted-foreground">
                {filters.boards[b].toLocaleString()}
              </span>
            )}
          </button>
        )
      })}
      <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
      {[
        { key: '7', label: t('7天内截止') },
        { key: '30', label: t('30天内截止') },
      ].map((d) => (
        <button
          key={d.key}
          type="button"
          aria-pressed={due === d.key}
          onClick={() => setDue(due === d.key ? '' : d.key)}
          className={cn(
            'inline-flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors',
            due === d.key
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'bg-background hover:bg-muted',
          )}
        >
          {d.label}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={hideExpired}
        onClick={() => setHideExpired((v) => !v)}
        className={cn(
          'inline-flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors',
          hideExpired
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'bg-background hover:bg-muted',
        )}
      >
        {t('隐藏已截止')}
      </button>
      {activeCount > 0 && (
        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={resetAll}>
          <X className="h-3.5 w-3.5" />
          {t('清空筛选')}
        </Button>
      )}
    </div>
  )

  const selectRow = (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <MultiSelect
        label=""
        triggerLabel={t('省份')}
        options={provinceOptions}
        selected={provinces}
        onChange={setProvinces}
      />
      <MultiSelect
        label=""
        triggerLabel={t('城市')}
        options={cityOptions}
        selected={cities}
        onChange={setCities}
      />
      <MultiSelect
        label=""
        triggerLabel={t('学历')}
        options={EDU_LEVELS}
        selected={edus}
        onChange={setEdus}
      />
    </div>
  )

  const searchForm = (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault()
        setKeyword(keywordInput.trim())
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={keywordInput}
        onChange={(e) => setKeywordInput(e.target.value)}
        placeholder={t('搜索岗位 / 单位 / 公司，自动搜索，回车立即搜索')}
        className="h-11 pl-8 sm:h-9"
        aria-label={t('关键词搜索')}
      />
    </form>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t('全部岗位')}</h2>
          <p className="text-xs text-muted-foreground">
            {t('体制内 · 校招 · 编制 三大板块合并检索')}
            {filters && (
              <>
                {' · '}
                {Object.entries(filters.boards)
                  .map(([b, n]) => `${b} ${n.toLocaleString()}`)
                  .join(' / ')}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            aria-label={t('排序')}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="recommended">{t('体制内优先')}</option>
            <option value="created_desc">{t('最新收录')}</option>
            <option value="deadline_asc">{t('截止最近')}</option>
          </select>
          <div className="flex overflow-hidden rounded-md border">
            <Button
              variant={view === 'card' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-9 rounded-none px-2.5"
              aria-label={t('卡片视图')}
              onClick={() => setView('card')}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={view === 'table' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-9 rounded-none px-2.5"
              aria-label={t('表格视图')}
              onClick={() => setView('table')}
            >
              <Table2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        {/* 桌面端完整筛选区 */}
        <div className="hidden space-y-3 md:block">
          {boardChips}
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
            <div className="lg:col-span-1">{searchForm}</div>
            <div className="lg:col-span-3">{selectRow}</div>
          </div>
        </div>
        {/* 移动端：搜索框常驻，其余筛选收进抽屉 */}
        <div className="space-y-3 md:hidden">
          {searchForm}
          <MobileFilterCollapse count={activeCount} title={t('全部岗位筛选')} onReset={resetAll}>
            {boardChips}
            {selectRow}
          </MobileFilterCollapse>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : !loading && items.length === 0 ? (
        <EmptyState
          title={t('没有找到匹配的岗位')}
          description={t('试试减少筛选条件或更换关键词')}
        />
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
            <span>
              {t('已加载')}{' '}
              <span className="font-medium text-foreground">{items.length.toLocaleString()}</span>
              {' / '}
              {displayTotal.toLocaleString()}{displayCapped ? '+' : ''} {t('条 · 滚动自动加载')}
            </span>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </div>
          {view === 'table' && (
            <div className="hidden grid-cols-[5rem_1fr_9rem_7rem_9rem_6rem] gap-2 border-b px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
              <span>{t('板块')}</span>
              <span>{t('岗位 / 单位')}</span>
              <span>{t('类别')}</span>
              <span>{t('学历')}</span>
              <span>{t('地点')}</span>
              <span>{t('截止')}</span>
            </div>
          )}
          <div ref={parentRef} className="h-[70vh] overflow-y-auto overscroll-contain">
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualItems.map((vi) => {
                const row = rows[vi.index]
                const item = row?.job
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    {item ? (
                      view === 'table' ? (
                        <div
                          role="button"
                          tabIndex={0}
                          className="grid w-full cursor-pointer grid-cols-[5rem_1fr_6rem] items-center gap-2 border-b px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 active:bg-muted md:grid-cols-[5rem_1fr_9rem_7rem_9rem_6rem]"
                          onClick={() => openJob(item)}
                          onKeyDown={(e) => e.key === 'Enter' && openJob(item)}
                        >
                          <Badge className={cn('w-fit text-[11px]', boardToneClass(item.source_board))}>
                            {item.source_board}
                          </Badge>
                          <span className="min-w-0 truncate">
                            <Highlight text={item.title || item.category || '-'} query={keyword} />
                            <span className="ml-1.5 hidden text-xs text-muted-foreground lg:inline">
                              <Highlight text={item.employer || ''} query={keyword} />
                            </span>
                          </span>
                          <span className="hidden truncate text-xs text-muted-foreground md:block">
                            {item.category || '-'}
                          </span>
                          <span className="hidden truncate text-xs text-muted-foreground md:block">
                            {item.edu_level_norm || '-'}
                          </span>
                          <span className="hidden truncate text-xs text-muted-foreground md:block">
                            {row.groupKey ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-0.5 text-primary hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleGroup(row.groupKey!)
                                }}
                              >
                                {tt`${row.cities.length || row.groupCount} 个城市`}
                                <ChevronDown className="h-3 w-3" />
                              </button>
                            ) : (
                              item.city || item.province || item.work_location || '-'
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {item.deadline_date ? (
                              <DueBadge date={item.deadline_date} />
                            ) : (
                              '-'
                            )}
                          </span>
                        </div>
                      ) : (
                        <div
                          role="button"
                          tabIndex={0}
                          className="flex w-full cursor-pointer items-start gap-2 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted"
                          onClick={() => openJob(item)}
                          onKeyDown={(e) => e.key === 'Enter' && openJob(item)}
                        >
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge className={cn('text-[11px]', boardToneClass(item.source_board))}>
                                {item.source_board}
                              </Badge>
                              {item.category && (
                                <Badge variant="outline" className="text-[11px]">
                                  {item.category}
                                </Badge>
                              )}
                              <DueBadge date={item.deadline_date ?? undefined} />
                              <span className="line-clamp-1 text-sm font-medium">
                                <Highlight text={item.title || item.category || '-'} query={keyword} />
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span className="inline-flex max-w-[60%] items-center gap-1">
                                <Building2 className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">
                                  <Highlight text={item.employer || '-'} query={keyword} />
                                </span>
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <GraduationCap className="h-3.5 w-3.5 shrink-0" />
                                {item.edu_level_norm || t('不限')}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5 shrink-0" />
                                {row.groupKey ? (
                                  <button
                                    type="button"
                                    className="inline-flex max-w-64 items-center gap-0.5 truncate text-primary hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleGroup(row.groupKey!)
                                    }}
                                  >
                                    {tt`${row.cities.length || row.groupCount} 个城市`}
                                    {row.cities.length > 0 && (
                                      <span className="truncate text-muted-foreground">
                                        （{row.cities.slice(0, 3).join(' / ')}
                                        {row.cities.length > 3 ? '…' : ''}）
                                      </span>
                                    )}
                                    <ChevronDown className="h-3 w-3 shrink-0" />
                                  </button>
                                ) : (
                                  <span className="max-w-40 truncate">
                                    {item.city || item.province || item.work_location || '-'}
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                          {(item.announce_url || item.apply_url) && (
                            <a
                              href={item.announce_url || item.apply_url || ''}
                              target="_blank"
                              rel="noreferrer noopener"
                              aria-label={t('打开公告链接')}
                              title={t('跳转原公告页')}
                              className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="flex items-center justify-center gap-2 px-4 py-4 text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('加载中…')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {expandedGroups.size > 0 && (
            <div className="border-t px-4 py-2 text-right">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setExpandedGroups(new Set())}
              >
                <ChevronUp className="h-3.5 w-3.5" />
                {t('折叠多城市岗位')}
              </button>
            </div>
          )}
        </div>
      )}

      {positionDetail && (
        <LazyPositionSheet
          item={positionDetail}
          onClose={() => setPositionDetail(null)}
          onOpenItem={setPositionDetail}
        />
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
          basics={[
            { label: t('公司'), value: campusDetail.company },
            { label: t('招聘岗位'), value: campusDetail.positions },
            { label: t('企业类型'), value: campusDetail.company_type },
            { label: t('行业'), value: campusDetail.industry },
            { label: t('批次'), value: campusDetail.batch },
            { label: t('届别'), value: campusDetail.grad_years },
            { label: t('免笔试'), value: campusDetail.no_exam },
            { label: t('内推码'), value: campusDetail.referral_code },
            { label: t('工作地点'), value: campusDetail.locations },
            { label: t('来源'), value: campusDetail.source_table },
            { label: t('备注'), value: campusDetail.notes },
          ]}
          requirements={[
            { label: t('学历要求'), value: campusDetail.edu_requirement },
            { label: t('专业要求'), value: campusDetail.major_requirement },
          ]}
          schedule={[
            { label: t('开始时间'), value: normalizeDateStr(campusDetail.start_date) },
            { label: t('截止时间'), value: normalizeDateStr(campusDetail.deadline_text) },
            { label: t('更新时间'), value: normalizeDateStr(campusDetail.updated_at_src) },
          ]}
          links={[
            { label: t('投递入口'), url: campusDetail.apply_url, checkDead: true },
            { label: t('公告链接'), url: campusDetail.announce_url },
          ]}
        />
      )}
      {bianzhiDetail && (
        <BoardJobSheet
          open={!!bianzhiDetail}
          onClose={() => setBianzhiDetail(null)}
          title={bianzhiDetail.employer || bianzhiDetail.job_type || '-'}
          badges={[bianzhiDetail.category, bianzhiDetail.province].filter(
            (b): b is string => !!b,
          )}
          shareText={bianzhiShare(bianzhiDetail)}
          favActive={bianzhiFavs.some((f) => f.id === bianzhiDetail.id)}
          onFavToggle={() => toggleBianzhiFavorite(bianzhiDetail)}
          basics={[
            { label: t('招聘单位'), value: bianzhiDetail.employer },
            { label: t('分类'), value: bianzhiDetail.category },
            { label: t('省份'), value: bianzhiDetail.province },
            { label: t('岗位类型'), value: bianzhiDetail.job_type },
            { label: t('招聘人数'), value: bianzhiDetail.headcount },
            { label: t('工作地点'), value: bianzhiDetail.work_location },
            { label: t('备注'), value: bianzhiDetail.notes },
          ]}
          requirements={[
            { label: t('学历要求'), value: bianzhiDetail.edu_requirement },
            { label: t('专业要求'), value: bianzhiDetail.major_requirement },
          ]}
          schedule={[
            { label: t('报名开始'), value: normalizeDateStr(bianzhiDetail.signup_start) },
            { label: t('报名截止'), value: normalizeDateStr(bianzhiDetail.deadline_text) },
            { label: t('考试时间'), value: bianzhiDetail.exam_time },
            { label: t('更新时间'), value: normalizeDateStr(bianzhiDetail.updated_at_src) },
          ]}
          links={[
            { label: t('公告链接'), url: bianzhiDetail.announce_url, checkDead: true },
            { label: t('报名入口'), url: bianzhiDetail.apply_url, checkDead: true },
          ]}
        />
      )}
    </div>
  )
}
