import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchCampusFilters,
  fetchCampusJobs,
  type CampusFilterOptions,
  type CampusJob,
  type CampusParams,
} from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { TONE_CLASSES, hashTone, type Tone } from '@/lib/badgeColors'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ExternalLink, LayoutGrid, Search, Table2, Ticket } from 'lucide-react'
import { BoardFavoriteButton } from '@/components/BoardFavoriteButton'
import { DueBadge } from '@/components/DueBadge'
import { SortableHead } from '@/components/SortableHead'
import { cmpNullableStr, nextSort, type SortState } from '@/lib/tableSort'
import { toggleCampusFavorite, useCampusFavorites } from '@/lib/boardFavorites'
import { applySeo } from '@/lib/seo'

const COMPANY_TYPE_TONES: Record<string, Tone> = {
  民企: 'blue',
  央国企: 'red',
  外企: 'purple',
  '外企/合资': 'purple',
  事业单位: 'violet',
  银行: 'indigo',
  国企: 'red',
}

const BATCH_TONES: Record<string, Tone> = {
  秋招: 'violet',
  春招: 'green',
  实习: 'cyan',
  秋招提前批: 'red',
  寒假实习: 'sky',
  暑期实习: 'teal',
  补录: 'amber',
}

function toneClass(map: Record<string, Tone>, value: string): string {
  return TONE_CLASSES[map[value] || hashTone(value)]
}

function SplitBadges({
  value,
  map,
  max = 3,
}: {
  value: string | null
  map: Record<string, Tone>
  max?: number
}) {
  if (!value) return <span className="text-muted-foreground">-</span>
  const parts = value
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max)
  return (
    <span className="flex flex-wrap gap-1">
      {parts.map((p) => (
        <Badge key={p} variant="secondary" className={cn('whitespace-nowrap border-0', toneClass(map, p))}>
          {p}
        </Badge>
      ))}
    </span>
  )
}

interface PresetView {
  key: string
  label: string
  params: Partial<CampusParams>
}

const PRESETS: PresetView[] = [
  { key: 'all', label: '全部', params: {} },
  { key: 'main', label: '校招汇总', params: { source_table: ['校招汇总表'] } },
  { key: 'noexam', label: '免笔试', params: { source_table: ['免笔试汇总'] } },
  { key: 'referral', label: '内推码', params: { referral_only: true } },
  { key: 'soe', label: '央国企名录', params: { source_table: ['央国企事业单位名录'] } },
  { key: 'soecampus', label: '央国企校招', params: { source_table: ['央国企校招'] } },
  { key: 'old', label: '24-25届可投', params: { source_table: ['24-25届可投'] } },
  { key: 'autumn', label: '秋招', params: { batch: '秋招' } },
  { key: 'spring', label: '春招', params: { batch: '春招' } },
  { key: 'intern', label: '实习', params: { batch: '实习' } },
  { key: 'y27autumn', label: '27届秋招', params: { batch: '秋招', grad_year: '2027' } },
  { key: 'internet', label: '互联网', params: { industry: ['互联网'] } },
  { key: 'finance', label: '银行金融', params: { industry: ['银行', '金融'] } },
  { key: 'soe2', label: '央国企', params: { company_type: ['央国企', '国企'] } },
  { key: 'foreign', label: '外企', params: { company_type: ['外企', '外企/合资', '合资', '中外合资'] } },
]

const PAGE_SIZE = 20

const CITY_CHIPS = [
  '北京',
  '上海',
  '广州',
  '深圳',
  '杭州',
  '南京',
  '成都',
  '武汉',
  '西安',
  '苏州',
  '天津',
  '重庆',
  '长沙',
  '青岛',
  '郑州',
  '合肥',
]

function daysAgoStr(days: number): string {
  const d = new Date(Date.now() - days * 86400000)
  return d.toISOString().slice(0, 10)
}

interface CampusPageProps {
  initialPreset?: string
  initialKeyword?: string
  crossPresets?: { key: string; label: string }[]
  onCrossPreset?: (key: string) => void
  crossLabel?: string
  crossFetchTotal?: (keyword: string) => Promise<number>
  onCrossOpen?: (keyword: string) => void
}

export function CampusPage({
  initialPreset,
  initialKeyword,
  crossPresets,
  onCrossPreset,
  crossLabel,
  crossFetchTotal,
  onCrossOpen,
}: CampusPageProps) {
  const urlQuery = useMemo(() => new URLSearchParams(window.location.search), [])
  const [preset, setPreset] = useState(
    initialPreset === 'recent7' ? 'all' : initialPreset ?? 'all',
  )
  const [keyword, setKeyword] = useState(initialKeyword ?? urlQuery.get('bkw') ?? '')
  const [searchInput, setSearchInput] = useState(initialKeyword ?? urlQuery.get('bkw') ?? '')
  const [crossTotal, setCrossTotal] = useState(0)
  const [companyTypes, setCompanyTypes] = useState<string[]>(() => {
    const v = urlQuery.get('ctype')
    return v ? v.split(',').filter(Boolean) : []
  })
  const [city, setCity] = useState<string | null>(urlQuery.get('city'))
  const [recentOnly, setRecentOnly] = useState(initialPreset === 'recent7')
  const [dueOnly, setDueOnly] = useState(
    () => new URLSearchParams(window.location.search).get('due') === '7',
  )
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ total: number; items: CampusJob[] } | null>(null)
  const [filters, setFilters] = useState<CampusFilterOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const campusFavorites = useCampusFavorites()
  const [view, setView] = useState<'table' | 'card'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'card' : 'table',
  )
  const [sort, setSort] = useState<SortState | null>(null)
  const toggleSort = useCallback((key: string) => setSort((s) => nextSort(s, key)), [])

  useEffect(() => {
    fetchCampusFilters().then(setFilters).catch(console.error)
  }, [])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('board') !== 'campus') return
    const urlPreset = recentOnly && preset === 'all' ? 'recent7' : preset
    q.set('bpreset', urlPreset)
    if (dueOnly) q.set('due', '7')
    else q.delete('due')
    if (city) q.set('city', city)
    else q.delete('city')
    if (companyTypes.length) q.set('ctype', companyTypes.join(','))
    else q.delete('ctype')
    if (keyword.trim()) q.set('bkw', keyword.trim())
    else q.delete('bkw')
    window.history.replaceState(null, '', `?${q.toString()}${window.location.hash}`)
    applySeo('campus', urlPreset)
  }, [preset, recentOnly, dueOnly, city, companyTypes, keyword])

  useEffect(() => {
    const kw = keyword.trim()
    if (!crossFetchTotal || kw.length < 2) {
      setCrossTotal(0)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      crossFetchTotal(kw)
        .then((n) => {
          if (!cancelled) setCrossTotal(n)
        })
        .catch(() => {})
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [keyword, crossFetchTotal])

  const params = useMemo<CampusParams>(() => {
    const p = PRESETS.find((v) => v.key === preset)?.params ?? {}
    return {
      ...p,
      keyword: keyword || undefined,
      company_type: companyTypes.length ? companyTypes : p.company_type,
      location: city || undefined,
      updated_after: recentOnly ? daysAgoStr(7) : undefined,
      due_within_days: dueOnly ? 7 : undefined,
      page,
      page_size: PAGE_SIZE,
    }
  }, [preset, keyword, companyTypes, city, recentOnly, dueOnly, page])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchCampusJobs(params)
      .then((res) => {
        if (!cancelled) setData({ total: res.total, items: res.items })
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [params])

  const selectPreset = useCallback((key: string) => {
    setPreset(key)
    setPage(1)
  }, [])

  const toggleCompanyType = useCallback((t: string) => {
    setCompanyTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
    setPage(1)
  }, [])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  const sortedItems = useMemo(() => {
    if (!data) return []
    if (!sort) return data.items
    const field = (j: CampusJob) =>
      sort.key === 'company'
        ? j.company
        : sort.key === 'deadline'
          ? j.deadline_date
          : sort.key === 'start'
            ? j.start_date
            : j.updated_at_src
    return [...data.items].sort((a, b) => cmpNullableStr(field(a), field(b), sort.dir))
  }, [data, sort])

  return (
    <div className="space-y-4">
      {/* 预设视图 chips */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2">
          {PRESETS.map((v) => (
            <button
              key={v.key}
              onClick={() => selectPreset(v.key)}
              className={cn(
                'min-h-9 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                preset === v.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              {v.label}
              {filters && v.params.source_table && (
                <span className="ml-1 text-xs opacity-70">
                  {filters.source_tables[v.params.source_table[0]] ?? ''}
                </span>
              )}
            </button>
          ))}
          {crossPresets && crossPresets.length > 0 && onCrossPreset && (
            <>
              <span className="my-auto h-4 w-px shrink-0 bg-border" aria-hidden="true" />
              {crossPresets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onCrossPreset(p.key)}
                  className="min-h-9 whitespace-nowrap rounded-full border border-dashed border-border bg-background px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {p.label}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {crossTotal > 0 && onCrossOpen && (
        <button
          type="button"
          onClick={() => onCrossOpen(keyword.trim())}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed bg-background px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span>
            {crossLabel || '另一板块'}中另有{' '}
            <span className="font-semibold text-foreground">{crossTotal.toLocaleString()}</span> 条与「
            {keyword.trim()}」相关，点击查看 →
          </span>
        </button>
      )}

      {/* 搜索 + 企业类型 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form
          className="relative flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            setKeyword(searchInput.trim())
            setPage(1)
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索公司 / 岗位 / 行业 / 专业…"
            className="h-10 pl-9"
          />
        </form>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="卡片视图"
            onClick={() => setView('card')}
            className={cn(
              'inline-flex h-10 w-10 items-center justify-center rounded-md border transition-colors',
              view === 'card'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="表格视图"
            onClick={() => setView('table')}
            className={cn(
              'inline-flex h-10 w-10 items-center justify-center rounded-md border transition-colors',
              view === 'table'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            <Table2 className="h-4 w-4" />
          </button>
        </div>
        {filters && (
          <div className="flex flex-wrap gap-1.5">
            {filters.company_types.slice(0, 6).map((t) => (
              <button
                key={t}
                onClick={() => toggleCompanyType(t)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs transition-colors',
                  companyTypes.includes(t)
                    ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                    : 'opacity-80 hover:opacity-100',
                  toneClass(COMPANY_TYPE_TONES, t),
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 城市筛选 + 近7天更新 */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex w-max items-center gap-1.5">
          <span className="mr-0.5 shrink-0 text-xs text-muted-foreground">城市</span>
          {CITY_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCity((prev) => (prev === c ? null : c))
                setPage(1)
              }}
              className={cn(
                'whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors',
                city === c
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              {c}
            </button>
          ))}
          <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
          <button
            type="button"
            onClick={() => {
              setRecentOnly((v) => !v)
              setPage(1)
            }}
            className={cn(
              'whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors',
              recentOnly
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
          >
            近7天更新
          </button>
          <button
            type="button"
            onClick={() => {
              setDueOnly((v) => !v)
              setPage(1)
            }}
            className={cn(
              'whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors',
              dueOnly
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
          >
            即将截止
          </button>
        </div>
      </div>

      {/* 计数 */}
      {data && (
        <div className="text-sm text-muted-foreground">
          共 <span className="font-medium text-foreground">{data.total.toLocaleString()}</span> 条
        </div>
      )}

      {/* 列表 */}
      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <EmptyState title="没有匹配的校招信息" description="试试更换预设视图或调整搜索关键词" />
      ) : view === 'table' ? (
        <div
          className={cn(
            'overflow-x-auto rounded-xl border bg-background',
            loading && 'pointer-events-none opacity-60',
          )}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" aria-label="收藏" />
                <SortableHead
                  label="公司"
                  sortKey="company"
                  sort={sort}
                  onToggle={toggleSort}
                  className="min-w-[140px]"
                />
                <TableHead>企业类型</TableHead>
                <TableHead className="min-w-[220px]">招聘岗位</TableHead>
                <TableHead>批次</TableHead>
                <TableHead>届次</TableHead>
                <TableHead>学历要求</TableHead>
                <TableHead>笔试</TableHead>
                <TableHead>行业</TableHead>
                <TableHead className="min-w-[120px]">工作地点</TableHead>
                <SortableHead label="开始时间" sortKey="start" sort={sort} onToggle={toggleSort} />
                <SortableHead label="截止时间" sortKey="deadline" sort={sort} onToggle={toggleSort} />
                <SortableHead label="更新日期" sortKey="updated" sort={sort} onToggle={toggleSort} />
                <TableHead>内推码</TableHead>
                <TableHead className="sticky right-0 z-10 bg-background shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)]">
                  投递/公告
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="p-1">
                    <BoardFavoriteButton
                      active={campusFavorites.some((f) => f.id === job.id)}
                      onToggle={() => toggleCampusFavorite(job)}
                    />
                  </TableCell>
                  <TableCell className="font-medium" title={job.company ?? ''}>
                    {job.company}
                    {job.source_table && (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {job.source_table}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {job.company_type ? (
                      <Badge
                        variant="secondary"
                        className={cn(
                          'whitespace-nowrap border-0',
                          toneClass(COMPANY_TYPE_TONES, job.company_type),
                        )}
                      >
                        {job.company_type}
                      </Badge>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell title={job.positions ?? ''}>
                    <span className="line-clamp-2 max-w-[340px] whitespace-normal">
                      {job.positions || '-'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <SplitBadges value={job.batch} map={BATCH_TONES} />
                  </TableCell>
                  <TableCell>
                    {job.grad_years ? (
                      <span className="flex flex-wrap gap-1">
                        {job.grad_years
                          .split(/\s*\|\s*/)
                          .filter(Boolean)
                          .slice(0, 3)
                          .map((y) => (
                            <Badge
                              key={y}
                              variant="secondary"
                              className={cn(
                                'whitespace-nowrap border-0',
                                y.includes('2027') || y.includes('2028')
                                  ? TONE_CLASSES.red
                                  : TONE_CLASSES.orange,
                              )}
                            >
                              {y}
                            </Badge>
                          ))}
                      </span>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell title={job.edu_requirement ?? ''}>
                    {job.edu_requirement ? (
                      <Badge variant="secondary" className={cn('whitespace-nowrap border-0', TONE_CLASSES.sky)}>
                        {job.edu_requirement.length > 12
                          ? job.edu_requirement.slice(0, 12) + '…'
                          : job.edu_requirement}
                      </Badge>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    {job.no_exam && job.no_exam !== '/' ? (
                      <Badge
                        variant="secondary"
                        className={cn(
                          'whitespace-nowrap border-0',
                          job.no_exam.includes('免') ? TONE_CLASSES.green : TONE_CLASSES.amber,
                        )}
                      >
                        {job.no_exam}
                      </Badge>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground" title={job.industry ?? ''}>
                    {job.industry
                      ? job.industry.length > 10
                        ? job.industry.slice(0, 10) + '…'
                        : job.industry
                      : '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground" title={job.locations ?? ''}>
                    {job.locations
                      ? job.locations.length > 16
                        ? job.locations.slice(0, 16) + '…'
                        : job.locations
                      : '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {job.start_date || '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      {job.deadline_text || '-'}
                      <DueBadge date={job.deadline_date} />
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {job.updated_at_src || '-'}
                  </TableCell>
                  <TableCell>
                    {job.referral_code ? (
                      <Badge variant="secondary" className={cn('gap-1 whitespace-nowrap border-0', TONE_CLASSES.emerald)}>
                        <Ticket className="h-3 w-3" />
                        {job.referral_code.length > 10
                          ? job.referral_code.slice(0, 10) + '…'
                          : job.referral_code}
                      </Badge>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="sticky right-0 z-10 bg-background shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)]">
                    <div className="flex gap-1.5">
                      {job.apply_url && job.apply_url.startsWith('http') && (
                        <a
                          href={job.apply_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                          投递 <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {job.announce_url && job.announce_url.startsWith('http') && (
                        <a
                          href={job.announce_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-muted"
                        >
                          公告 <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className={cn('space-y-2', loading && 'pointer-events-none opacity-60')}>
          {data?.items.map((job) => (
            <div
              key={job.id}
              className="rounded-xl border bg-background p-4 transition-colors hover:border-primary/20 hover:shadow-md"
            >
              <div className="flex flex-wrap items-center gap-2">
                <BoardFavoriteButton
                  className="-ml-2 -my-1"
                  active={campusFavorites.some((f) => f.id === job.id)}
                  onToggle={() => toggleCampusFavorite(job)}
                />
                <span className="text-base font-semibold">{job.company}</span>
                {job.company_type && (
                  <Badge variant="secondary" className={cn('border-0', toneClass(COMPANY_TYPE_TONES, job.company_type))}>
                    {job.company_type}
                  </Badge>
                )}
                {job.no_exam && job.no_exam !== '/' && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'border-0',
                      job.no_exam.includes('免') ? TONE_CLASSES.green : TONE_CLASSES.amber,
                    )}
                  >
                    {job.no_exam}
                  </Badge>
                )}
                {job.referral_code && (
                  <Badge variant="secondary" className={cn('gap-1 border-0', TONE_CLASSES.emerald)}>
                    <Ticket className="h-3 w-3" />
                    内推码 {job.referral_code.length > 16 ? job.referral_code.slice(0, 16) + '…' : job.referral_code}
                  </Badge>
                )}
                {job.source_table && (
                  <Badge variant="secondary" className={cn('border-0', TONE_CLASSES.slate)}>
                    {job.source_table}
                  </Badge>
                )}
                {job.updated_at_src && (
                  <span className="ml-auto text-xs text-muted-foreground">更新：{job.updated_at_src}</span>
                )}
              </div>
              {job.positions && (
                <p className="mt-1.5 line-clamp-2 text-sm text-foreground/90">{job.positions}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                <SplitBadges value={job.batch} map={BATCH_TONES} />
                {job.grad_years && (
                  <span className="flex flex-wrap gap-1">
                    {job.grad_years
                      .split(/\s*\|\s*/)
                      .filter(Boolean)
                      .slice(0, 4)
                      .map((y) => (
                        <Badge
                          key={y}
                          variant="secondary"
                          className={cn('border-0', y.includes('2027') || y.includes('2028') ? TONE_CLASSES.red : TONE_CLASSES.orange)}
                        >
                          {y}
                        </Badge>
                      ))}
                  </span>
                )}
                {job.edu_requirement && (
                  <Badge variant="secondary" className={cn('border-0', TONE_CLASSES.sky)}>
                    {job.edu_requirement.length > 20
                      ? job.edu_requirement.slice(0, 20) + '…'
                      : job.edu_requirement}
                  </Badge>
                )}
                {job.industry && <span className="text-muted-foreground">{job.industry}</span>}
                {job.locations && <span className="text-muted-foreground">{job.locations}</span>}
                {job.start_date && (
                  <span className="text-muted-foreground">开始：{job.start_date}</span>
                )}
                {job.deadline_text && (
                  <span className="text-muted-foreground">截止：{job.deadline_text}</span>
                )}
                <DueBadge date={job.deadline_date} />
              </div>
              {job.major_requirement && job.major_requirement.trim() !== '/' && (
                <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                  专业：{job.major_requirement}
                </p>
              )}
              {job.notes && job.notes.trim() !== '/' && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">备注：{job.notes}</p>
              )}
              {(job.apply_url || job.announce_url) && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {job.apply_url && job.apply_url.startsWith('http') && (
                    <a
                      href={job.apply_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      投递入口 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {job.announce_url && job.announce_url.startsWith('http') && (
                    <a
                      href={job.announce_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
                    >
                      查看公告 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 分页 */}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm text-muted-foreground">
            第 {page} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
