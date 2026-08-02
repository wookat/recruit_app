import { TableSwipeHint } from './TableSwipeHint'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildCampusExportUrl,
  createBoardExport,
  fetchCampusCounts,
  fetchCampusFilters,
  fetchCampusJob,
  fetchCampusJobs,
  type CampusFilterOptions,
  type CampusJob,
  type CampusParams,
} from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PullToRefresh } from './PullToRefresh'
import { EmptyState } from '@/components/EmptyState'
import { ActiveFilterChips, FilterSummaryBar, type RemovableFilter } from '@/components/ActiveFilterChips'
import { Highlight } from '@/components/Highlight'
import { TONE_CLASSES, TONE_TEXT_STRONG, hashTone, type Tone } from '@/lib/badgeColors'
import { cn } from '@/lib/utils'
import { formatDueDayLabel } from '@/lib/deadline'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ExternalLink, LayoutGrid, Search, Table2, Ticket } from 'lucide-react'
import { BoardExportButton } from '@/components/BoardExportButton'
import { BoardFavoriteButton } from '@/components/BoardFavoriteButton'
import { SeenBadge } from '@/components/SeenBadge'
import { useSeenSet } from '@/lib/viewHistory'
import { BoardCompareButton } from '@/components/BoardCompareButton'
import { CrossBoardZeroHint } from '@/components/CrossBoardZeroHint'
import { SearchSuggestInput } from '@/components/SearchSuggestInput'
import { SavedFilterBar } from '@/components/SavedFilterBar'
import { MatchByProfileButton } from '@/components/MatchByProfileButton'
import { MobileFilterCollapse } from '@/components/MobileFilterCollapse'
import { BoardRecommendSection } from '@/components/BoardRecommendSection'
import { getProfile, profileUsable } from '@/lib/profile'
import { BoardJobSheet } from '@/components/BoardJobSheet'
import { deriveCampusTags } from '@/lib/jobTags'
import { readJobParam } from '@/lib/jobDeepLink'
import { sheetNavProps } from '@/lib/sheetNav'
import { addRecentSearch } from '@/lib/storage'
import { ShareTextButton, buildShareText } from '@/components/ShareTextButton'
import { DueBadge } from '@/components/DueBadge'
import { FreshnessNote } from '@/components/FreshnessNote'
import { SortableHead } from '@/components/SortableHead'
import { cmpNullableStr, nextSort, normalizeDateStr, type SortState } from '@/lib/tableSort'
import { toggleCampusFavorite, useCampusFavorites } from '@/lib/boardFavorites'
import { applySeo } from '@/lib/seo'
import { jobShareUrl } from '@/lib/clipboard'

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
  秋招提前批: 'amber',
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

const CAMPUS_SUGGEST_WORDS = [
  '央国企',
  '国企',
  '银行',
  '外企',
  '互联网',
  '金融',
  '中国移动',
  '中国电信',
  '中国联通',
  '国家电网',
  '中石油',
  '中石化',
  '中烟',
  '铁路',
  '中国邮政',
  '工商银行',
  '农业银行',
  '中国银行',
  '建设银行',
  '产品经理',
  '算法',
  '软件开发',
  '数据分析',
  '运营',
  '管培生',
  '实习',
  '秋招',
  '春招',
  '免笔试',
  '内推',
]

function campusShareText(job: CampusJob): string {
  return buildShareText({
    org: job.company,
    title: job.positions,
    location: job.locations,
    deadline: job.deadline_text || job.deadline_date,
    deepLink: jobShareUrl('campus', job.id),
    url: job.announce_url || job.apply_url,
  })
}

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
  onOpenBoardKw?: (board: 'positions' | 'campus' | 'bianzhi', keyword: string) => void
}

export function CampusPage({
  initialPreset,
  initialKeyword,
  crossPresets,
  onCrossPreset,
  crossLabel,
  crossFetchTotal,
  onCrossOpen,
  onOpenBoardKw,
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
  const [hideExpired, setHideExpired] = useState(() => {
    const q = new URLSearchParams(window.location.search)
    return q.get('board') === 'campus' && q.get('hexp') === '1'
  })
  const [hideSeen, setHideSeen] = useState(() => {
    const q = new URLSearchParams(window.location.search)
    return q.get('board') === 'campus' && q.get('hseen') === '1'
  })
  const seenSet = useSeenSet()
  const [page, setPage] = useState(1)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [typeCounts, setTypeCounts] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    let alive = true
    fetchCampusCounts().then((c) => {
      if (alive && c) setTypeCounts(c.company_types)
    })
    return () => {
      alive = false
    }
  }, [])
  const [data, setData] = useState<{ total: number; items: CampusJob[] } | null>(null)
  const [filters, setFilters] = useState<CampusFilterOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const campusFavorites = useCampusFavorites()
  const [view, setView] = useState<'table' | 'card'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'card' : 'table',
  )
  const [sort, setSort] = useState<SortState | null>(null)
  const [detail, setDetail] = useState<CampusJob | null>(null)
  const [relatedJobs, setRelatedJobs] = useState<CampusJob[]>([])

  useEffect(() => {
    const company = detail?.company?.trim()
    const detailId = detail?.id
    if (!company) {
      setRelatedJobs([])
      return
    }
    let cancelled = false
    fetchCampusJobs({ keyword: company, page: 1, page_size: 20 })
      .then((res) => {
        if (cancelled) return
        setRelatedJobs(
          res.items
            .filter((j) => j.id !== detailId && (j.company ?? '').trim() === company)
            .slice(0, 5),
        )
      })
      .catch(() => {
        if (!cancelled) setRelatedJobs([])
      })
    return () => {
      cancelled = true
    }
  }, [detail?.company, detail?.id])
  const [profileMatched, setProfileMatched] = useState(() => {
    const p = getProfile()
    if (!profileUsable(p)) return false
    const q = new URLSearchParams(window.location.search)
    const kw = q.get('bkw') ?? ''
    const c = q.get('city')
    return (
      (!!kw || !!c) && kw === p.major.trim() && (c ?? null) === (p.location[0] ?? null)
    )
  })
  const deepLinkDone = useRef(false)
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
    if (hideExpired) q.set('hexp', '1')
    else q.delete('hexp')
    if (hideSeen) q.set('hseen', '1')
    else q.delete('hseen')
    if (city) q.set('city', city)
    else q.delete('city')
    if (companyTypes.length) q.set('ctype', companyTypes.join(','))
    else q.delete('ctype')
    if (keyword.trim()) q.set('bkw', keyword.trim())
    else q.delete('bkw')
    window.history.replaceState(null, '', `?${q.toString()}${window.location.hash}`)
    applySeo('campus', urlPreset)
  }, [preset, recentOnly, dueOnly, hideExpired, hideSeen, city, companyTypes, keyword])

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
      hide_expired: !dueOnly && hideExpired ? true : undefined,
      page,
      page_size: PAGE_SIZE,
    }
  }, [preset, keyword, companyTypes, city, recentOnly, dueOnly, hideExpired, page])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    fetchCampusJobs(params, controller.signal)
      .then((res) => {
        if (cancelled) return
        setData({ total: res.total, items: res.items })
        if (!deepLinkDone.current) {
          deepLinkDone.current = true
          const id = readJobParam('campus')
          if (id) {
            const hit = res.items.find((j) => j.id === id)
            if (hit) setDetail(hit)
            else {
              fetchCampusJob(id)
                .then((job) => {
                  if (!cancelled) setDetail(job)
                })
                .catch(() => undefined)
            }
          }
        }
      })
      .catch((e) => {
        if (!cancelled) console.error(e)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [params, refreshNonce])

  const selectPreset = useCallback((key: string) => {
    setPreset(key)
    setPage(1)
  }, [])

  const toggleCompanyType = useCallback((t: string) => {
    setCompanyTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
    setPage(1)
  }, [])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  /** 导出文件名：板块+筛选摘要+日期 */
  const exportFname = useMemo(() => {
    const presetLabel = PRESETS.find((v) => v.key === preset)?.label
    const parts = [
      '校招',
      preset !== 'all' ? presetLabel : undefined,
      ...companyTypes,
      city || undefined,
      keyword || undefined,
      recentOnly ? '近7天' : undefined,
      dueOnly ? '7天内截止' : undefined,
      !dueOnly && hideExpired ? '未过期' : undefined,
      new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    ]
    return parts.filter(Boolean).join('-')
  }, [preset, companyTypes, city, keyword, recentOnly, dueOnly, hideExpired])

  const activeFilters: RemovableFilter[] = []
  if (keyword)
    activeFilters.push({
      label: `关键词：${keyword}`,
      onRemove: () => {
        setKeyword('')
        setSearchInput('')
        setPage(1)
      },
    })
  if (city)
    activeFilters.push({
      label: `城市：${city}`,
      onRemove: () => {
        setCity(null)
        setPage(1)
      },
    })
  for (const t of companyTypes)
    activeFilters.push({ label: `类型：${t}`, onRemove: () => toggleCompanyType(t) })
  if (preset !== 'all') {
    const presetLabel = PRESETS.find((v) => v.key === preset)?.label
    if (presetLabel)
      activeFilters.push({ label: `视图：${presetLabel}`, onRemove: () => selectPreset('all') })
  }
  if (recentOnly)
    activeFilters.push({
      label: '近7天更新',
      onRemove: () => {
        setRecentOnly(false)
        setPage(1)
      },
    })
  if (dueOnly)
    activeFilters.push({
      label: '即将截止',
      onRemove: () => {
        setDueOnly(false)
        setPage(1)
      },
    })
  if (hideExpired)
    activeFilters.push({
      label: '隐藏已截止',
      onRemove: () => {
        setHideExpired(false)
        setPage(1)
      },
    })
  if (hideSeen)
    activeFilters.push({
      label: '隐藏已看过',
      onRemove: () => setHideSeen(false),
    })
  if (profileMatched)
    activeFilters.push({
      label: '按我的条件匹配',
      onRemove: () => {
        setSearchInput('')
        setKeyword('')
        setCity(null)
        setPage(1)
        setProfileMatched(false)
      },
    })

  function clearAllFilters() {
    setPreset('all')
    setRecentOnly(false)
    setDueOnly(false)
    setHideExpired(false)
    setHideSeen(false)
    setCity(null)
    setCompanyTypes([])
    setSearchInput('')
    setKeyword('')
    setProfileMatched(false)
    setPage(1)
  }

  const sortedItems = useMemo(() => {
    if (!data) return []
    if (!sort) return data.items
    const field = (j: CampusJob) =>
      sort.key === 'company'
        ? j.company
        : sort.key === 'deadline'
          ? j.deadline_date
          : sort.key === 'start'
            ? normalizeDateStr(j.start_date)
            : normalizeDateStr(j.updated_at_src)
    return [...data.items].sort((a, b) => cmpNullableStr(field(a), field(b), sort.dir))
  }, [data, sort])

  const visibleItems = useMemo(
    () => (hideSeen ? sortedItems.filter((j) => !seenSet.has(`campus:${j.id}`)) : sortedItems),
    [sortedItems, hideSeen, seenSet],
  )
  const hiddenSeenCount = sortedItems.length - visibleItems.length

  const [cardMore, setCardMore] = useState<Set<number>>(new Set())
  const toggleCardMore = useCallback((id: number) => {
    setCardMore((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const typeChips = filters ? (
    <div className="flex flex-wrap gap-1.5">
      {filters.company_types.slice(0, 6).map((t) => (
        <button
          key={t}
          onClick={() => toggleCompanyType(t)}
          className={cn(
            'min-h-11 rounded-full px-2.5 py-1 text-xs transition-colors md:min-h-0',
            companyTypes.includes(t)
              ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
              : 'hover:brightness-95 dark:hover:brightness-110',
            toneClass(COMPANY_TYPE_TONES, t),
            TONE_TEXT_STRONG[COMPANY_TYPE_TONES[t] || hashTone(t)],
          )}
        >
          {t}
          {typeCounts?.[t] != null && (
            <span data-count className="ml-1 hidden sm:inline">
              {typeCounts[t].toLocaleString()}
            </span>
          )}
        </button>
      ))}
    </div>
  ) : null

  const cityFilterRow = (
    <div className="scrollbar-none -mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
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
              'min-h-11 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors md:min-h-0',
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
            'min-h-11 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors md:min-h-0',
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
            'min-h-11 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors md:min-h-0',
            dueOnly
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground hover:bg-muted',
          )}
        >
          即将截止
        </button>
        <button
          type="button"
          onClick={() => {
            setHideExpired((v) => !v)
            setPage(1)
          }}
          className={cn(
            'min-h-11 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors md:min-h-0',
            hideExpired
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground hover:bg-muted',
          )}
        >
          隐藏已截止
        </button>
        <button
          type="button"
          onClick={() => setHideSeen((v) => !v)}
          className={cn(
            'min-h-11 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors md:min-h-0',
            hideSeen
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground hover:bg-muted',
          )}
        >
          隐藏已看过
        </button>
      </div>
    </div>
  )

  const mobileFilterCount =
    companyTypes.length +
    (city ? 1 : 0) +
    (recentOnly ? 1 : 0) +
    (dueOnly ? 1 : 0) +
    (hideExpired ? 1 : 0) +
    (hideSeen ? 1 : 0)

  return (
    <div className="space-y-4">
      {/* 预设视图 chips */}
      <div className="scrollbar-none -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2">
          {PRESETS.map((v) => (
            <button
              key={v.key}
              onClick={() => selectPreset(v.key)}
              className={cn(
                'min-h-11 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors sm:min-h-9',
                preset === v.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              {v.label}
              {filters && v.params.source_table && (
                <span className="ml-1 text-xs">
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
                  className="min-h-11 whitespace-nowrap rounded-full border border-dashed border-border bg-background px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-h-9"
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

      <MatchByProfileButton
        note="按专业+城市匹配（校招暂无学历筛选，已跳过该维度）"
        active={profileMatched}
        onApply={(p) => {
          const kw = p.major.trim()
          setSearchInput(kw)
          setKeyword(kw)
          setCity(p.location[0] ?? null)
          setPage(1)
          setProfileMatched(true)
        }}
        onClear={() => {
          setSearchInput('')
          setKeyword('')
          setCity(null)
          setPage(1)
          setProfileMatched(false)
        }}
      />

      <BoardRecommendSection
        board="campus"
        onOpenDetail={(j) => setDetail(j as CampusJob)}
      />

      <SavedFilterBar
        board="campus"
        snapshot={(() => {
          const s: Record<string, string> = {}
          const urlPreset = recentOnly && preset === 'all' ? 'recent7' : preset
          if (urlPreset !== 'all') s.bpreset = urlPreset
          if (dueOnly) s.due = '7'
          if (city) s.city = city
          if (companyTypes.length) s.ctype = companyTypes.join(',')
          if (keyword.trim()) s.bkw = keyword.trim()
          return s
        })()}
        defaultName={
          [
            city,
            companyTypes[0],
            preset !== 'all' ? PRESETS.find((p) => p.key === preset)?.label : null,
            recentOnly ? '近7天更新' : null,
            dueOnly ? '即将截止' : null,
            keyword.trim() || null,
          ]
            .filter(Boolean)
            .join('·') || '校招筛选'
        }
        canSave={
          preset !== 'all' ||
          recentOnly ||
          dueOnly ||
          !!city ||
          companyTypes.length > 0 ||
          !!keyword.trim()
        }
      />

      {/* 搜索 + 企业类型 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchSuggestInput
          value={searchInput}
          onValueChange={(v) => {
            setSearchInput(v)
            setKeyword(v)
            setPage(1)
          }}
          onSelect={(text) => {
            setSearchInput(text)
            setKeyword(text)
            setPage(1)
            if (text.length >= 2) addRecentSearch(text)
          }}
          words={CAMPUS_SUGGEST_WORDS}
          placeholder="搜索公司 / 岗位 / 行业 / 专业…"
          inputClassName="h-10"
        />
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
        {typeChips && <div className="hidden md:block">{typeChips}</div>}
      </div>

      {/* 城市筛选 + 近7天更新（桌面） */}
      <div className="hidden md:block">{cityFilterRow}</div>

      {/* 移动端筛选：超两行自动折叠 */}
      <MobileFilterCollapse count={mobileFilterCount} title="校招筛选">
        {typeChips}
        {cityFilterRow}
      </MobileFilterCollapse>

      {/* 计数 + 导出 */}
      {data && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            共 <span className="font-medium text-foreground">{data.total.toLocaleString()}</span> 条
          </span>
          <FreshnessNote board="campus" />
          <BoardExportButton
            className="ml-auto"
            total={data.total}
            buildSyncUrl={() => buildCampusExportUrl(params, exportFname)}
            startAsync={(maxRows) => createBoardExport('campus', params, exportFname, maxRows)}
          />
        </div>
      )}

      <FilterSummaryBar filters={activeFilters} onClearAll={clearAllFilters} />

      {hideSeen && hiddenSeenCount > 0 && (
        <div className="text-xs text-muted-foreground">本页已隐藏 {hiddenSeenCount} 条已看过的岗位</div>
      )}

      {/* 列表 */}
      <PullToRefresh onRefresh={() => setRefreshNonce((n) => n + 1)} refreshing={loading}>
      {loading && !data ? (
        view === 'table' ? (
          <div className="space-y-3 rounded-xl border bg-background p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-6" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2.5 rounded-xl border bg-background p-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-16 rounded-4xl" />
                  <Skeleton className="h-5 w-12 rounded-4xl" />
                  <Skeleton className="ml-auto h-4 w-20" />
                </div>
                <Skeleton className="h-5 w-3/5" />
                <div className="flex gap-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>
            ))}
          </div>
        )
      ) : data && data.items.length === 0 ? (
        <div className="space-y-3">
          <EmptyState
            title="没有匹配的校招信息"
            description="建议优先移除关键词，其次城市、企业类型筛选"
            action={<ActiveFilterChips filters={activeFilters} />}
          />
          {keyword.trim() && onOpenBoardKw && (
            <CrossBoardZeroHint from="campus" keyword={keyword} onOpen={onOpenBoardKw} />
          )}
        </div>
      ) : view === 'table' ? (
        <div
          className={cn(
            'overflow-x-auto rounded-xl border bg-background [scrollbar-width:thin]',
            loading && 'pointer-events-none opacity-60',
          )}
        >
          <TableSwipeHint />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">收藏</span>
                </TableHead>
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
                <TableHead className="hidden 2xl:table-cell">行业</TableHead>
                <TableHead className="min-w-[120px]">工作地点</TableHead>
                <SortableHead label="开始时间" sortKey="start" sort={sort} onToggle={toggleSort} className="hidden 2xl:table-cell" />
                <SortableHead label="截止时间" sortKey="deadline" sort={sort} onToggle={toggleSort} />
                <SortableHead label="更新日期" sortKey="updated" sort={sort} onToggle={toggleSort} />
                <TableHead>内推码</TableHead>
                <TableHead className="sticky right-0 z-10 border-l bg-card shadow-[-8px_0_12px_-6px_rgba(0,0,0,0.18)]">
                  投递/公告
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.map((job, i, arr) => (
                <Fragment key={job.id}>
                  {dueOnly && !sort && (i === 0 || arr[i - 1].deadline_date !== job.deadline_date) && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={99}
                        className="bg-muted/40 py-1.5 text-xs font-medium text-muted-foreground"
                      >
                        {formatDueDayLabel(job.deadline_date)}
                      </TableCell>
                    </TableRow>
                  )}
                <TableRow className="cursor-pointer" onClick={() => setDetail(job)}>
                  <TableCell className="p-1">
                    <div className="flex items-center">
                      <BoardFavoriteButton
                        active={campusFavorites.some((f) => f.id === job.id)}
                        onToggle={() => toggleCampusFavorite(job)}
                      />
                      <BoardCompareButton item={{ board: 'campus', job }} />
                      <ShareTextButton text={campusShareText(job)} />
                    </div>
                  </TableCell>
                  <TableCell className="font-medium" title={job.company ?? ''}>
                    <Highlight text={job.company} query={keyword} />
                    <SeenBadge board="campus" id={job.id} className="ml-1.5" />
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
                      <Highlight text={job.positions || '-'} query={keyword} />
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
                                  ? TONE_CLASSES.blue
                                  : TONE_CLASSES.slate,
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
                  <TableCell className="hidden text-muted-foreground 2xl:table-cell" title={job.industry ?? ''}>
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
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground 2xl:table-cell">
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
                  <TableCell title={job.referral_code ?? ''}>
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
                  <TableCell className="sticky right-0 z-10 border-l bg-card shadow-[-8px_0_12px_-6px_rgba(0,0,0,0.18)]">
                    <div className="flex gap-1.5">
                      {job.apply_url && job.apply_url.startsWith('http') && (
                        <a
                          href={job.apply_url}
                          target="_blank" onClick={(e) => e.stopPropagation()}
                          rel="noopener noreferrer"
                          className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                          投递 <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {job.announce_url && job.announce_url.startsWith('http') && (
                        <a
                          href={job.announce_url}
                          target="_blank" onClick={(e) => e.stopPropagation()}
                          rel="noopener noreferrer"
                          className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-muted"
                        >
                          公告 <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className={cn('space-y-2', loading && 'pointer-events-none opacity-60')}>
          {visibleItems.map((job, i, arr) => (
            <Fragment key={job.id}>
              {dueOnly && (i === 0 || arr[i - 1].deadline_date !== job.deadline_date) && (
                <div className="pt-1 text-xs font-medium text-muted-foreground">
                  {formatDueDayLabel(job.deadline_date)}
                </div>
              )}
            <div
              className="cursor-pointer rounded-xl border bg-background p-4 transition-colors hover:border-primary/20 hover:shadow-md"
              onClick={() => setDetail(job)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <BoardFavoriteButton
                  className="-ml-2 -my-1"
                  active={campusFavorites.some((f) => f.id === job.id)}
                  onToggle={() => toggleCampusFavorite(job)}
                />
                <BoardCompareButton className="-ml-1 -my-1" item={{ board: 'campus', job }} />
                <ShareTextButton className="-ml-1 -my-1" text={campusShareText(job)} />
                <span className="text-base font-semibold">
                  <Highlight text={job.company} query={keyword} />
                </span>
                <SeenBadge board="campus" id={job.id} />
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
                {deriveCampusTags(job)
                  .filter((t) => t.key === 'anymajor')
                  .map((t) => (
                    <Badge key={t.key} variant="secondary" className="border-0 bg-muted font-normal text-foreground/80 dark:text-muted-foreground">
                      {t.label}
                    </Badge>
                  ))}
                {job.source_table && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'border-0',
                      TONE_CLASSES.slate,
                      cardMore.has(job.id) ? 'inline-flex' : 'hidden sm:inline-flex',
                    )}
                  >
                    {job.source_table}
                  </Badge>
                )}
                {job.updated_at_src && (
                  <span className="ml-auto text-xs text-muted-foreground">更新：{job.updated_at_src}</span>
                )}
              </div>
              {job.positions && (
                <p className="mt-1.5 line-clamp-2 text-sm text-foreground/90">
                  <Highlight text={job.positions} query={keyword} />
                </p>
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
                          className={cn('border-0', y.includes('2027') || y.includes('2028') ? TONE_CLASSES.blue : TONE_CLASSES.slate)}
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
                {job.industry && (
                  <span className={cn('text-muted-foreground', cardMore.has(job.id) ? 'inline' : 'hidden sm:inline')}>
                    {job.industry}
                  </span>
                )}
                {job.locations && <span className="text-muted-foreground">{job.locations}</span>}
                {job.start_date && (
                  <span className={cn('text-muted-foreground', cardMore.has(job.id) ? 'inline' : 'hidden sm:inline')}>
                    开始：{job.start_date}
                  </span>
                )}
                {job.deadline_text && (
                  <span className="text-muted-foreground">截止：{job.deadline_text}</span>
                )}
                <DueBadge date={job.deadline_date} />
              </div>
              {job.major_requirement && job.major_requirement.trim() !== '/' && (
                <p className={cn('mt-1.5 line-clamp-2 text-xs text-muted-foreground', cardMore.has(job.id) ? 'block' : 'hidden sm:block')}>
                  专业：{job.major_requirement}
                </p>
              )}
              {job.notes && job.notes.trim() !== '/' && (
                <p className={cn('mt-1 line-clamp-2 text-xs text-muted-foreground', cardMore.has(job.id) ? 'block' : 'hidden sm:block')}>
                  备注：{job.notes}
                </p>
              )}
              {(job.source_table ||
                job.industry ||
                job.start_date ||
                (job.major_requirement && job.major_requirement.trim() !== '/') ||
                (job.notes && job.notes.trim() !== '/')) && (
                <button
                  type="button"
                  className="mt-1 flex min-h-8 items-center text-xs text-muted-foreground underline-offset-2 hover:underline sm:hidden"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleCardMore(job.id)
                  }}
                >
                  {cardMore.has(job.id) ? '收起' : '更多'}
                </button>
              )}
              {(job.apply_url || job.announce_url) && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {job.apply_url && job.apply_url.startsWith('http') && (
                    <a
                      href={job.apply_url}
                      target="_blank" onClick={(e) => e.stopPropagation()}
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      投递入口 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {job.announce_url && job.announce_url.startsWith('http') && (
                    <a
                      href={job.announce_url}
                      target="_blank" onClick={(e) => e.stopPropagation()}
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
                    >
                      查看公告 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
            </Fragment>
          ))}
        </div>
      )}
      </PullToRefresh>

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

      {detail && (
        <BoardJobSheet
          open={!!detail}
          onClose={() => setDetail(null)}
          title={detail.company || '-'}
          badges={[detail.company_type, detail.source_table].filter((b): b is string => !!b)}
          tags={deriveCampusTags(detail).map((t) => ({
            ...t,
            onClick:
              t.key === 'noexam' || t.key === 'referral'
                ? () => {
                    selectPreset(t.key)
                    setDetail(null)
                  }
                : undefined,
          }))}
          shareText={campusShareText(detail)}
          favActive={campusFavorites.some((f) => f.id === detail.id)}
          onFavToggle={() => toggleCampusFavorite(detail)}
          jobKey={`campus:${detail.id}`}
          {...sheetNavProps(visibleItems, detail, setDetail)}
          basics={[
            { label: '公司', value: detail.company },
            { label: '招聘岗位', value: detail.positions },
            { label: '企业类型', value: detail.company_type },
            { label: '行业', value: detail.industry },
            { label: '批次', value: detail.batch },
            { label: '届别', value: detail.grad_years },
            { label: '免笔试', value: detail.no_exam },
            { label: '内推码', value: detail.referral_code },
            { label: '工作地点', value: detail.locations },
            { label: '来源', value: detail.source_table },
            { label: '备注', value: detail.notes },
          ]}
          requirements={[
            { label: '学历要求', value: detail.edu_requirement },
            { label: '专业要求', value: detail.major_requirement },
          ]}
          schedule={[
            { label: '开始时间', value: detail.start_date },
            { label: '截止时间', value: detail.deadline_text },
            { label: '更新时间', value: detail.updated_at_src },
          ]}
          links={[
            { label: '投递入口', url: detail.apply_url },
            { label: '公告链接', url: detail.announce_url },
          ]}
          related={
            relatedJobs.length > 0
              ? {
                  title: '同公司其他岗位',
                  items: relatedJobs.map((j) => ({
                    key: String(j.id),
                    label: j.positions || j.batch || j.company || '-',
                    sub: [j.locations, j.deadline_text ? `截止：${j.deadline_text}` : null]
                      .filter(Boolean)
                      .join(' · '),
                  })),
                  onSelect: (key) => {
                    const hit = relatedJobs.find((j) => String(j.id) === key)
                    if (hit) setDetail(hit)
                  },
                }
              : undefined
          }
        />
      )}
    </div>
  )
}
