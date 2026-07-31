import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchBianzhiFilters,
  fetchBianzhiJobs,
  type BianzhiFilterOptions,
  type BianzhiJob,
  type BianzhiParams,
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
import { ExternalLink, GraduationCap, Landmark, LayoutGrid, Search, Table2 } from 'lucide-react'
import { BoardFavoriteButton } from '@/components/BoardFavoriteButton'
import { toggleBianzhiFavorite, useBianzhiFavorites } from '@/lib/boardFavorites'
import hrSites from '@/data/hrSites.json'

const MajorGuideSheet = lazy(() =>
  import('@/components/MajorGuideSheet').then((m) => ({ default: m.MajorGuideSheet })),
)

const CATEGORY_TONES: Record<string, Tone> = {
  公务员事业单位: 'blue',
  教育系统: 'green',
  医疗系统: 'red',
  高校高职大专: 'violet',
  科研院所: 'cyan',
  央国企社招: 'orange',
  大型联考: 'amber',
}

function toneClass(map: Record<string, Tone>, value: string): string {
  return TONE_CLASSES[map[value] || hashTone(value)]
}

interface PresetView {
  key: string
  label: string
  category?: string
}

const PRESETS: PresetView[] = [
  { key: 'all', label: '全部' },
  { key: 'gwy', label: '公务员事业单位', category: '公务员事业单位' },
  { key: 'edu', label: '教育系统', category: '教育系统' },
  { key: 'med', label: '医疗系统', category: '医疗系统' },
  { key: 'univ', label: '高校高职大专', category: '高校高职大专' },
  { key: 'sci', label: '科研院所', category: '科研院所' },
  { key: 'soe', label: '央国企社招', category: '央国企社招' },
  { key: 'lk', label: '大型联考', category: '大型联考' },
]

const PAGE_SIZE = 20

interface BianzhiPageProps {
  initialPreset?: string
  initialKeyword?: string
  crossPresets?: { key: string; label: string }[]
  onCrossPreset?: (key: string) => void
}

export function BianzhiPage({
  initialPreset,
  initialKeyword,
  crossPresets,
  onCrossPreset,
}: BianzhiPageProps) {
  const [preset, setPreset] = useState(initialPreset ?? 'all')
  const [keyword, setKeyword] = useState(initialKeyword ?? '')
  const [searchInput, setSearchInput] = useState(initialKeyword ?? '')
  const [provinces, setProvinces] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ total: number; items: BianzhiJob[] } | null>(null)
  const [filters, setFilters] = useState<BianzhiFilterOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const bianzhiFavorites = useBianzhiFavorites()
  const [showHrSites, setShowHrSites] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [view, setView] = useState<'table' | 'card'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'card' : 'table',
  )

  useEffect(() => {
    fetchBianzhiFilters().then(setFilters).catch(console.error)
  }, [])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('board') !== 'bianzhi') return
    q.set('bpreset', preset)
    window.history.replaceState(null, '', `?${q.toString()}`)
  }, [preset])

  const params = useMemo<BianzhiParams>(() => {
    const cat = PRESETS.find((v) => v.key === preset)?.category
    return {
      category: cat ? [cat] : undefined,
      province: provinces.length ? provinces : undefined,
      keyword: keyword || undefined,
      page,
      page_size: PAGE_SIZE,
    }
  }, [preset, keyword, provinces, page])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchBianzhiJobs(params)
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

  const toggleProvince = useCallback((p: string) => {
    setProvinces((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
    setPage(1)
  }, [])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const isLiankao = preset === 'lk'

  return (
    <div className="space-y-4">
      {/* 分类 chips */}
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
              {filters && v.category && (
                <span className="ml-1 text-xs opacity-70">
                  {(filters.categories[v.category] ?? 0).toLocaleString()}
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

      {/* 搜索 + 省份 */}
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
            placeholder="搜索招聘单位 / 工作地 / 专业…"
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
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => setGuideOpen(true)}>
            <GraduationCap className="h-4 w-4" />
            专业就业方向
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-10 gap-1.5"
            onClick={() => setShowHrSites((v) => !v)}
          >
            <Landmark className="h-4 w-4" />
            各省人社官网
          </Button>
        </div>
      </div>

      {showHrSites && (
        <div className="rounded-xl border bg-background p-3">
          <p className="mb-2 text-xs text-muted-foreground">各省份人力资源和社会保障厅官方招聘页（{hrSites.length} 个）</p>
          <div className="flex flex-wrap gap-1.5">
            {hrSites.map((s) => (
              <a
                key={s.province}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted"
              >
                {s.province} <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        {guideOpen && <MajorGuideSheet open={guideOpen} onClose={() => setGuideOpen(false)} />}
      </Suspense>

      {/* 省份 chips */}
      {filters && filters.provinces.length > 0 && (
        <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <div className="flex w-max gap-1.5">
            {filters.provinces.slice(0, 32).map((p) => (
              <button
                key={p}
                onClick={() => toggleProvince(p)}
                className={cn(
                  'whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors',
                  provinces.includes(p)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

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
        <EmptyState title="没有匹配的编制公告" description="试试更换分类或调整搜索关键词" />
      ) : view === 'card' ? (
        <div className={cn('space-y-2', loading && 'pointer-events-none opacity-60')}>
          {data?.items.map((job) => (
            <div
              key={job.id}
              className="rounded-xl border bg-background p-4 transition-colors hover:border-primary/20 hover:shadow-md"
            >
              <div className="flex flex-wrap items-center gap-2">
                <BoardFavoriteButton
                  className="-ml-2 -my-1"
                  active={bianzhiFavorites.some((f) => f.id === job.id)}
                  onToggle={() => toggleBianzhiFavorite(job)}
                />
                <span className="text-base font-semibold">
                  {job.employer ||
                    (job.category === '大型联考'
                      ? `${job.province ?? ''}${job.job_type ?? ''}联考`
                      : '-')}
                </span>
                {job.category && (
                  <Badge variant="secondary" className={cn('border-0', toneClass(CATEGORY_TONES, job.category))}>
                    {job.category}
                  </Badge>
                )}
                {job.updated_at_src && (
                  <span className="ml-auto text-xs text-muted-foreground">更新：{job.updated_at_src}</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                {job.province && <span className="text-muted-foreground">{job.province}</span>}
                {job.work_location && (
                  <span className="text-muted-foreground">{job.work_location}</span>
                )}
                {job.job_type && <span className="text-muted-foreground">{job.job_type}</span>}
                {job.headcount && (
                  <span className="text-muted-foreground">招 {job.headcount} 人</span>
                )}
                {job.edu_requirement && (
                  <Badge variant="secondary" className={cn('border-0', TONE_CLASSES.sky)}>
                    {job.edu_requirement.length > 12
                      ? job.edu_requirement.slice(0, 12) + '…'
                      : job.edu_requirement}
                  </Badge>
                )}
                {isLiankao ? (
                  <>
                    {job.signup_start && (
                      <span className="text-muted-foreground">报名：{job.signup_start}</span>
                    )}
                    {job.exam_time && (
                      <span className="text-muted-foreground">考试：{job.exam_time}</span>
                    )}
                  </>
                ) : (
                  job.deadline_text && (
                    <span className="text-muted-foreground">截止：{job.deadline_text}</span>
                  )
                )}
              </div>
              {job.major_requirement && job.major_requirement.trim() !== '/' && (
                <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                  专业：{job.major_requirement}
                </p>
              )}
              {job.notes && job.notes.trim() !== '/' && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">备注：{job.notes}</p>
              )}
              {(job.announce_url || job.apply_url) && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {job.announce_url && job.announce_url.startsWith('http') && (
                    <a
                      href={job.announce_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-11 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:h-8"
                    >
                      查看公告 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {job.apply_url && job.apply_url.startsWith('http') && (
                    <a
                      href={job.apply_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-11 items-center gap-1 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted sm:h-8"
                    >
                      报名入口 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
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
                <TableHead className="min-w-[260px]">招聘单位 / 公告</TableHead>
                <TableHead>分类</TableHead>
                <TableHead>省份</TableHead>
                <TableHead className="min-w-[110px]">工作地</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>人数</TableHead>
                <TableHead>学历要求</TableHead>
                <TableHead className="min-w-[160px]">专业/学科</TableHead>
                {isLiankao ? (
                  <>
                    <TableHead>报名开始</TableHead>
                    <TableHead>考试时间</TableHead>
                  </>
                ) : (
                  <TableHead className="min-w-[140px]">截止时间</TableHead>
                )}
                <TableHead>更新</TableHead>
                <TableHead className="sticky right-0 z-10 bg-background shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)]">
                  链接
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="p-1">
                    <BoardFavoriteButton
                      active={bianzhiFavorites.some((f) => f.id === job.id)}
                      onToggle={() => toggleBianzhiFavorite(job)}
                    />
                  </TableCell>
                  <TableCell className="font-medium" title={job.employer ?? ''}>
                    <span className="line-clamp-2 max-w-[380px] whitespace-normal">
                      {job.employer || (job.category === '大型联考' ? `${job.province ?? ''}${job.job_type ?? ''}联考` : '-')}
                    </span>
                    {job.notes && job.notes.trim() !== '/' && (
                      <span className="mt-0.5 block max-w-[380px] truncate text-[11px] text-muted-foreground" title={job.notes}>
                        {job.notes}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {job.category ? (
                      <Badge
                        variant="secondary"
                        className={cn('whitespace-nowrap border-0', toneClass(CATEGORY_TONES, job.category))}
                      >
                        {job.category}
                      </Badge>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{job.province || '-'}</TableCell>
                  <TableCell className="text-muted-foreground" title={job.work_location ?? ''}>
                    {job.work_location
                      ? job.work_location.length > 12
                        ? job.work_location.slice(0, 12) + '…'
                        : job.work_location
                      : '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground" title={job.job_type ?? ''}>
                    {job.job_type
                      ? job.job_type.length > 10
                        ? job.job_type.slice(0, 10) + '…'
                        : job.job_type
                      : '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground" title={job.headcount ?? ''}>
                    {job.headcount
                      ? job.headcount.length > 8
                        ? job.headcount.slice(0, 8) + '…'
                        : job.headcount
                      : '-'}
                  </TableCell>
                  <TableCell title={job.edu_requirement ?? ''}>
                    {job.edu_requirement ? (
                      <Badge variant="secondary" className={cn('whitespace-nowrap border-0', TONE_CLASSES.sky)}>
                        {job.edu_requirement.length > 10
                          ? job.edu_requirement.slice(0, 10) + '…'
                          : job.edu_requirement}
                      </Badge>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground" title={job.major_requirement ?? ''}>
                    <span className="line-clamp-2 max-w-[220px] whitespace-normal">
                      {job.major_requirement && job.major_requirement.trim() !== '/'
                        ? job.major_requirement
                        : '-'}
                    </span>
                  </TableCell>
                  {isLiankao ? (
                    <>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {job.signup_start || '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {job.exam_time || '-'}
                      </TableCell>
                    </>
                  ) : (
                    <TableCell className="text-muted-foreground" title={job.deadline_text ?? ''}>
                      {job.deadline_text
                        ? job.deadline_text.length > 14
                          ? job.deadline_text.slice(0, 14) + '…'
                          : job.deadline_text
                        : '-'}
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {job.updated_at_src || '-'}
                  </TableCell>
                  <TableCell className="sticky right-0 z-10 bg-background shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)]">
                    <div className="flex gap-1.5">
                      {job.announce_url && job.announce_url.startsWith('http') && (
                        <a
                          href={job.announce_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                          公告 <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {job.apply_url && job.apply_url.startsWith('http') && (
                        <a
                          href={job.apply_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-muted"
                        >
                          报名 <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
