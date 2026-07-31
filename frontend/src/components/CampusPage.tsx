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
import { ExternalLink, Search, Ticket } from 'lucide-react'

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
  { key: 'old', label: '24-25届可投', params: { source_table: ['24-25届可投'] } },
  { key: 'autumn', label: '秋招', params: { batch: '秋招' } },
  { key: 'spring', label: '春招', params: { batch: '春招' } },
  { key: 'intern', label: '实习', params: { batch: '实习' } },
]

const PAGE_SIZE = 20

export function CampusPage() {
  const [preset, setPreset] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [companyTypes, setCompanyTypes] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ total: number; items: CampusJob[] } | null>(null)
  const [filters, setFilters] = useState<CampusFilterOptions | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCampusFilters().then(setFilters).catch(console.error)
  }, [])

  const params = useMemo<CampusParams>(() => {
    const p = PRESETS.find((v) => v.key === preset)?.params ?? {}
    return {
      ...p,
      keyword: keyword || undefined,
      company_type: companyTypes.length ? companyTypes : undefined,
      page,
      page_size: PAGE_SIZE,
    }
  }, [preset, keyword, companyTypes, page])

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
        </div>
      </div>

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
      ) : (
        <div className={cn('space-y-2', loading && 'pointer-events-none opacity-60')}>
          {data?.items.map((job) => (
            <div
              key={job.id}
              className="rounded-xl border bg-background p-4 transition-colors hover:border-primary/20 hover:shadow-md"
            >
              <div className="flex flex-wrap items-center gap-2">
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
                {job.updated_at_src && (
                  <span className="ml-auto text-xs text-muted-foreground">{job.updated_at_src}</span>
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
                {job.industry && <span className="text-muted-foreground">{job.industry}</span>}
                {job.locations && <span className="text-muted-foreground">{job.locations}</span>}
                {job.deadline_text && (
                  <span className="text-muted-foreground">截止：{job.deadline_text}</span>
                )}
              </div>
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
