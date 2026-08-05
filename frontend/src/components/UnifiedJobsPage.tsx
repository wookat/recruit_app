import { t } from '@/lib/i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  fetchUnifiedJobFilters,
  fetchUnifiedJobs,
  type UnifiedBoard,
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
import { TONE_CLASSES, hashTone, type Tone } from '@/lib/badgeColors'
import { cn } from '@/lib/utils'
import {
  Building2,
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

const BOARD_KEYS: Record<UnifiedBoard, 'positions' | 'campus' | 'bianzhi'> = {
  体制内: 'positions',
  校招: 'campus',
  编制: 'bianzhi',
}

const EDU_LEVELS = ['博士研究生', '硕士研究生', '本科', '大专/中专', '其他/不限']

const PAGE_SIZE = 50
const ROW_ESTIMATE = 96

function boardToneClass(board: string): string {
  return TONE_CLASSES[BOARD_TONES[board] || hashTone(board)]
}

function readUrlState() {
  const q = new URLSearchParams(window.location.search)
  const csv = (k: string) => (q.get(k) || '').split(',').filter(Boolean)
  return {
    keyword: q.get('ajkw') || '',
    boards: csv('ajb'),
    provinces: csv('ajp'),
    cities: csv('ajc'),
    edus: csv('aje'),
    due: q.get('ajdue') || '',
    hideExpired: q.get('ajhexp') === '1',
    sort: (q.get('ajsort') === 'deadline_asc' ? 'deadline_asc' : 'created_desc') as
      | 'created_desc'
      | 'deadline_asc',
    view: (q.get('ajview') === 'table' ? 'table' : 'card') as 'card' | 'table',
  }
}

interface UnifiedJobsPageProps {
  onOpenJob?: (board: 'positions' | 'campus' | 'bianzhi', id: number) => void
}

export function UnifiedJobsPage({ onOpenJob }: UnifiedJobsPageProps) {
  const init = useMemo(readUrlState, [])
  const [keywordInput, setKeywordInput] = useState(init.keyword)
  const [keyword, setKeyword] = useState(init.keyword)
  const [boards, setBoards] = useState<string[]>(init.boards)
  const [provinces, setProvinces] = useState<string[]>(init.provinces)
  const [cities, setCities] = useState<string[]>(init.cities)
  const [edus, setEdus] = useState<string[]>(init.edus)
  const [due, setDue] = useState(init.due)
  const [hideExpired, setHideExpired] = useState(init.hideExpired)
  const [sort, setSort] = useState<'created_desc' | 'deadline_asc'>(init.sort)
  const [view, setView] = useState<'card' | 'table'>(init.view)
  const [filters, setFilters] = useState<UnifiedJobFilters | null>(null)

  const [items, setItems] = useState<UnifiedJob[]>([])
  const [total, setTotal] = useState(0)
  const [totalCapped, setTotalCapped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [exhausted, setExhausted] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const parentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchUnifiedJobFilters().then((f) => f && setFilters(f))
  }, [])

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
    setOrDel('ajsort', sort === 'deadline_asc' ? sort : '')
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
      parentRef.current?.scrollTo({ top: 0 })
      loadPage(1)
    }, 250)
    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [loadPage])

  const hasMore = !exhausted && items.length < total

  const virtualizer = useVirtualizer({
    count: hasMore ? items.length + 1 : items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (view === 'table' ? 52 : ROW_ESTIMATE),
    overscan: 8,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1]
    if (!last) return
    if (last.index >= items.length - 1 && hasMore && !loading && items.length > 0) {
      loadPage(Math.floor(items.length / PAGE_SIZE) + 1)
    }
  }, [virtualItems, items, hasMore, loading, loadPage])

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

  const openJob = (job: UnifiedJob) => {
    if (onOpenJob) onOpenJob(BOARD_KEYS[job.source_board], job.source_id)
    else if (job.announce_url || job.apply_url) {
      window.open(job.announce_url || job.apply_url || '', '_blank', 'noopener')
    }
  }

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
            onChange={(e) => setSort(e.target.value as 'created_desc' | 'deadline_asc')}
          >
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <form
            className="relative sm:col-span-2 lg:col-span-1"
            onSubmit={(e) => {
              e.preventDefault()
              setKeyword(keywordInput.trim())
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onBlur={() => setKeyword(keywordInput.trim())}
              placeholder={t('搜索岗位 / 单位 / 公司…')}
              className="h-11 pl-8 sm:h-9"
              aria-label={t('关键词搜索')}
            />
          </form>
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
              {total.toLocaleString()}{totalCapped ? '+' : ''} {t('条 · 滚动自动加载')}
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
                const item = items[vi.index]
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
                            {item.city || item.province || item.work_location || '-'}
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
                                <span className="max-w-40 truncate">
                                  {item.city || item.province || item.work_location || '-'}
                                </span>
                              </span>
                            </div>
                          </div>
                          {(item.announce_url || item.apply_url) && (
                            <a
                              href={item.announce_url || item.apply_url || ''}
                              target="_blank"
                              rel="noreferrer noopener"
                              aria-label={t('打开公告链接')}
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
        </div>
      )}
    </div>
  )
}
