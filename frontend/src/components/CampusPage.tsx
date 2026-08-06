import { t, tt } from '@/lib/i18n'
import { TableSwipeHint } from './TableSwipeHint'
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildCampusExportUrl,
  createBoardExport,
  fetchCampusCounts,
  fetchCampusFilters,
  fetchCampusJob,
  fetchCampusJobs,
  fetchCampusTimeline,
  type CampusTimeline,
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
import { formatDueDayLabel, getEffectiveDeadline, isLongTermDate } from '@/lib/deadline'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ArrowUpRight, ChartColumn, ExternalLink, LayoutGrid, Map as MapIcon, Search, Table2, Ticket } from 'lucide-react'
import { BoardExportButton } from '@/components/BoardExportButton'
import { BoardFavoriteButton } from '@/components/BoardFavoriteButton'
import { SeenBadge } from '@/components/SeenBadge'
import { NewDot } from '@/components/NewDot'
import { useSeenSet } from '@/lib/viewHistory'
import { markBoardVisit } from '@/lib/lastVisit'
import { NewSinceBanner } from '@/components/NewSinceBanner'
import { BoardCompareButton } from '@/components/BoardCompareButton'
import { CrossBoardZeroHint } from '@/components/CrossBoardZeroHint'
import { SearchSuggestInput } from '@/components/SearchSuggestInput'
import { SavedFilterBar } from '@/components/SavedFilterBar'
import { SubscribeFilterHint } from '@/components/SubscribeFilterHint'
import { SynonymHint } from '@/components/SynonymHint'
import { HotSearchPills } from '@/components/HotSearchPills'
import { expandKeyword, HOT_SEARCHES_CAMPUS } from '@/lib/synonyms'
import { addRecentSearch, saveQuery } from '@/lib/storage'
import { getViewPref, setViewPref, useOnNarrowScreen } from '@/lib/viewPref'
import { MatchByProfileButton } from '@/components/MatchByProfileButton'
import { MobileFilterCollapse } from '@/components/MobileFilterCollapse'
import { MultiSelect, type OptionGroup } from '@/components/MultiSelect'
import { BoardRecommendSection } from '@/components/BoardRecommendSection'
import { BoardJobSheet } from '@/components/BoardJobSheet'
import { deriveCampusTags } from '@/lib/jobTags'
import { readJobParam } from '@/lib/jobDeepLink'
import { sheetNavProps } from '@/lib/sheetNav'
import { fetchSimilarCampus } from '@/lib/similarJobs'

import { ShareTextButton, buildShareText } from '@/components/ShareTextButton'
import { DueBadge } from '@/components/DueBadge'
import { ExpiredDividerBlock, ExpiredDividerRow, isExpiredDate } from '@/components/ExpiredDivider'
import { FreshnessNote } from '@/components/FreshnessNote'
import { SortableHead } from '@/components/SortableHead'
import { cmpNullableStr, nextSort, normalizeDateStr, type SortState } from '@/lib/tableSort'
import { toggleCampusFavorite, useCampusFavorites } from '@/lib/boardFavorites'
import { applySeo } from '@/lib/seo'
import { jobShareUrl } from '@/lib/clipboard'

const CityMapPanel = lazy(() => import('@/components/CityMapPanel'))
const TimelinePanel = lazy(() => import('@/components/TimelinePanel'))

const EDU_OPTIONS = ['本科', '硕士', '博士', '大专']

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
  { key: 'all', label: t("全部"), params: {} },
  // params 为查询值，必须保持中文（数据内容为中文，译文查询会 0 结果）
  { key: 'main', label: t("校招汇总"), params: { source_table: ['校招汇总表'] } },
  { key: 'noexam', label: t("免笔试"), params: { source_table: ['免笔试汇总'] } },
  { key: 'referral', label: t("内推码"), params: { referral_only: true } },
  { key: 'soe', label: t("央国企名录"), params: { source_table: ['央国企事业单位名录'] } },
  { key: 'soecampus', label: t("央国企校招"), params: { source_table: ['央国企校招'] } },
  { key: 'old', label: t("24-25届可投"), params: { source_table: ['24-25届可投'] } },
  { key: 'autumn', label: t("秋招"), params: { batch: '秋招' } },
  { key: 'spring', label: t("春招"), params: { batch: '春招' } },
  { key: 'intern', label: t("实习"), params: { batch: '实习' } },
  { key: 'y27autumn', label: t("27届秋招"), params: { batch: '秋招', grad_year: '2027' } },
  { key: 'internet', label: t("互联网"), params: { industry: ['互联网'] } },
  { key: 'finance', label: t("银行金融"), params: { industry: ['银行', '金融'] } },
  { key: 'soe2', label: t("央国企"), params: { company_type: ['央国企', '国企'] } },
  { key: 'foreign', label: t("外企"), params: { company_type: ['外企', '外企/合资', '合资', '中外合资'] } },
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
  const [keyword, setKeyword] = useState(
    initialKeyword ?? urlQuery.get('bkw') ?? urlQuery.get('kw') ?? '',
  )
  const [searchInput, setSearchInput] = useState(
    initialKeyword ?? urlQuery.get('bkw') ?? urlQuery.get('kw') ?? '',
  )
  const [crossTotal, setCrossTotal] = useState(0)
  const [synOff, setSynOff] = useState(false)
  const [companyTypes, setCompanyTypes] = useState<string[]>(() => {
    const v = urlQuery.get('ctype')
    return v ? v.split(',').filter(Boolean) : []
  })
  const [cities, setCities] = useState<string[]>(() => {
    const v = urlQuery.get('city')
    return v ? v.split(',').filter(Boolean) : []
  })
  const [eduFilter, setEduFilter] = useState(
    urlQuery.get('board') === 'campus' ? urlQuery.get('cedu') ?? '' : '',
  )
  const [recentOnly, setRecentOnly] = useState(initialPreset === 'recent7')
  const [timeRange, setTimeRange] = useState<{ from: string; to: string } | null>(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('board') !== 'campus') return null
    const from = q.get('cfrom')
    const to = q.get('cto')
    return /^\d{4}-\d{2}-\d{2}$/.test(from ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(to ?? '')
      ? { from: from as string, to: to as string }
      : null
  })
  const [dueOnly, setDueOnly] = useState(
    () => new URLSearchParams(window.location.search).get('due') === '7',
  )
  const [hideExpired, setHideExpired] = useState(() => {
    const q = new URLSearchParams(window.location.search)
    return q.get('board') === 'campus' && q.get('hexp') === '1'
  })
  const [newSince, setNewSince] = useState<string | null>(null)
  const [hideSeen, setHideSeen] = useState(() => {
    const q = new URLSearchParams(window.location.search)
    return q.get('board') === 'campus' && q.get('hseen') === '1'
  })
  const seenSet = useSeenSet()
  const [page, setPage] = useState(1)
  const listTopRef = useRef<HTMLDivElement | null>(null)
  const gotoPage = useCallback((delta: number) => {
    setPage((p) => Math.max(1, p + delta))
    listTopRef.current?.scrollIntoView({ block: 'start' })
  }, [])
  const [refreshNonce, setRefreshNonce] = useState(0)
  const refreshResolveRef = useRef<(() => void) | null>(null)
  const [typeCounts, setTypeCounts] = useState<Record<string, number> | null>(null)
  const [cityCounts, setCityCounts] = useState<Record<string, number>>({})
  const [mapOpen, setMapOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [timeline, setTimeline] = useState<CampusTimeline | null>(null)

  useEffect(() => {
    if (!timelineOpen || timeline) return
    let alive = true
    fetchCampusTimeline().then((t) => {
      if (alive && t) setTimeline(t)
    })
    return () => {
      alive = false
    }
  }, [timelineOpen, timeline])
  const [cityOptions, setCityOptions] = useState<string[]>([])
  const [cityProvinces, setCityProvinces] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    fetchCampusCounts().then((c) => {
      if (!alive || !c) return
      setTypeCounts(c.company_types)
      if (c.cities) {
        setCityOptions(Object.keys(c.cities))
        setCityCounts(c.cities)
      }
      if (c.city_provinces) setCityProvinces(c.city_provinces)
    })
    return () => {
      alive = false
    }
  }, [])
  /** 「更多城市」按省份分组（省内城市保持岗位数降序，无映射城市归「其他地区」） */
  const cityGroups = useMemo<OptionGroup[] | null>(() => {
    if (!cityOptions.length || !Object.keys(cityProvinces).length) return null
    const byProv = new Map<string, string[]>()
    for (const c of cityOptions) {
      const prov = cityProvinces[c] ?? t("其他地区")
      const arr = byProv.get(prov)
      if (arr) arr.push(c)
      else byProv.set(prov, [c])
    }
    const groups = [...byProv.entries()].map(([label, options]) => ({ label, options }))
    groups.sort((a, b) =>
      a.label === '其他地区' ? 1 : b.label === '其他地区' ? -1 : b.options.length - a.options.length,
    )
    return groups
  }, [cityOptions, cityProvinces])
  const [data, setData] = useState<{ total: number; items: CampusJob[] } | null>(null)
  const [filters, setFilters] = useState<CampusFilterOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const campusFavorites = useCampusFavorites()
  const [view, setView] = useState<'table' | 'card'>(() => getViewPref('campus'))
  useOnNarrowScreen(useCallback(() => setView((v) => (v === 'table' ? 'card' : v)), []))
  const selectView = useCallback((v: 'table' | 'card') => {
    setView(v)
    setViewPref('campus', v)
  }, [])
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

  const [similarJobs, setSimilarJobs] = useState<CampusJob[]>([])

  useEffect(() => {
    if (!detail) {
      setSimilarJobs([])
      return
    }
    let cancelled = false
    const d = detail
    fetchSimilarCampus(d)
      .then((items) => {
        if (!cancelled) setSimilarJobs(items)
      })
      .catch(() => {
        if (!cancelled) setSimilarJobs([])
      })
    return () => {
      cancelled = true
    }
  }, [detail])
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
    if (cities.length) q.set('city', cities.join(','))
    else q.delete('city')
    if (eduFilter) q.set('cedu', eduFilter)
    else q.delete('cedu')
    if (companyTypes.length) q.set('ctype', companyTypes.join(','))
    else q.delete('ctype')
    if (keyword.trim()) q.set('bkw', keyword.trim())
    else q.delete('bkw')
    if (timeRange) {
      q.set('cfrom', timeRange.from)
      q.set('cto', timeRange.to)
    } else {
      q.delete('cfrom')
      q.delete('cto')
    }
    q.delete('kw')
    window.history.replaceState(null, '', `?${q.toString()}${window.location.hash}`)
    applySeo('campus', urlPreset)
  }, [preset, recentOnly, dueOnly, hideExpired, hideSeen, cities, eduFilter, companyTypes, keyword, timeRange])

  useEffect(() => {
    markBoardVisit('campus')
  }, [])

  useEffect(() => {
    const kw = keyword.trim()
    setCrossTotal(0)
    if (!crossFetchTotal || kw.length < 2) return
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

  const kwTrim = keyword.trim()
  useEffect(() => {
    setSynOff(false)
  }, [kwTrim])
  const synAdded = useMemo(
    () => (synOff || !kwTrim ? [] : expandKeyword(kwTrim).added),
    [kwTrim, synOff],
  )

  const params = useMemo<CampusParams>(() => {
    const p = PRESETS.find((v) => v.key === preset)?.params ?? {}
    return {
      ...p,
      keyword: kwTrim ? (synAdded.length ? expandKeyword(kwTrim).expanded : kwTrim) : undefined,
      company_type: companyTypes.length ? companyTypes : p.company_type,
      edu: eduFilter || undefined,
      location: cities.length ? cities.join(',') : undefined,
      updated_after: timeRange ? timeRange.from : recentOnly ? daysAgoStr(7) : undefined,
      updated_before: timeRange ? timeRange.to : undefined,
      created_after: newSince ?? undefined,
      due_within_days: dueOnly ? 7 : undefined,
      hide_expired: !dueOnly && hideExpired ? true : undefined,
      page,
      page_size: PAGE_SIZE,
    }
  }, [preset, kwTrim, synAdded, companyTypes, cities, eduFilter, recentOnly, timeRange, dueOnly, hideExpired, newSince, page])

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
        refreshResolveRef.current?.()
        refreshResolveRef.current = null
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
      t("校招"),
      preset !== 'all' ? presetLabel : undefined,
      ...companyTypes,
      ...cities,
      eduFilter || undefined,
      keyword || undefined,
      recentOnly ? t("近7天") : undefined,
      dueOnly ? t("7天内截止") : undefined,
      !dueOnly && hideExpired ? t("未过期") : undefined,
      new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    ]
    return parts.filter(Boolean).join('-')
  }, [preset, companyTypes, cities, eduFilter, keyword, recentOnly, dueOnly, hideExpired])

  const filterSnapshot = (() => {
    const s: Record<string, string> = {}
    const urlPreset = recentOnly && preset === 'all' ? 'recent7' : preset
    if (urlPreset !== 'all') s.bpreset = urlPreset
    if (dueOnly) s.due = '7'
    if (cities.length) s.city = cities.join(',')
    if (companyTypes.length) s.ctype = companyTypes.join(',')
    if (eduFilter) s.cedu = eduFilter
    if (keyword.trim()) s.bkw = keyword.trim()
    if (timeRange) {
      s.cfrom = timeRange.from
      s.cto = timeRange.to
    }
    return s
  })()
  const filterDefaultName =
    [
      cities.length === 0
        ? null
        : cities.length <= 3
          ? cities.join('+')
          : tt`${cities.slice(0, 3).join('+')}等${cities.length}地`,
      companyTypes.length === 0
        ? null
        : companyTypes.length <= 3
          ? companyTypes.join('+')
          : tt`${companyTypes.slice(0, 3).join('+')}等${companyTypes.length}类`,
      eduFilter || null,
      preset !== 'all' ? PRESETS.find((p) => p.key === preset)?.label : null,
      recentOnly ? t("近7天更新") : null,
      dueOnly ? t("即将截止") : null,
      keyword.trim() || null,
    ]
      .filter(Boolean)
      .join('·') || t("校招筛选")
  const filterCanSave =
    preset !== 'all' ||
    recentOnly ||
    !!timeRange ||
    dueOnly ||
    cities.length > 0 ||
    companyTypes.length > 0 ||
    !!eduFilter ||
    !!keyword.trim()

  const activeFilters: RemovableFilter[] = []
  if (keyword)
    activeFilters.push({
      label: tt`关键词：${keyword}`,
      onRemove: () => {
        setKeyword('')
        setSearchInput('')
        setPage(1)
      },
    })
  for (const c of cities)
    activeFilters.push({
      label: tt`城市：${c}`,
      onRemove: () => {
        setCities((prev) => prev.filter((x) => x !== c))
        setPage(1)
      },
    })
  for (const t of companyTypes)
    activeFilters.push({ label: tt`类型：${t}`, onRemove: () => toggleCompanyType(t) })
  if (eduFilter)
    activeFilters.push({
      label: tt`学历：${eduFilter}`,
      onRemove: () => {
        setEduFilter('')
        setPage(1)
      },
    })
  if (preset !== 'all') {
    const presetLabel = PRESETS.find((v) => v.key === preset)?.label
    if (presetLabel)
      activeFilters.push({ label: tt`视图：${presetLabel}`, onRemove: () => selectPreset('all') })
  }
  if (recentOnly)
    activeFilters.push({
      label: t("近7天更新"),
      onRemove: () => {
        setRecentOnly(false)
        setPage(1)
      },
    })
  if (timeRange)
    activeFilters.push({
      label: tt`更新时段：${timeRange.from}~${timeRange.to}`,
      onRemove: () => {
        setTimeRange(null)
        setPage(1)
      },
    })
  if (dueOnly)
    activeFilters.push({
      label: t("即将截止"),
      onRemove: () => {
        setDueOnly(false)
        setPage(1)
      },
    })
  if (hideExpired)
    activeFilters.push({
      label: t("隐藏已截止"),
      onRemove: () => {
        setHideExpired(false)
        setPage(1)
      },
    })
  if (hideSeen)
    activeFilters.push({
      label: t("隐藏已看过"),
      onRemove: () => setHideSeen(false),
    })
  if (newSince)
    activeFilters.push({
      label: t("仅看上次访问后新增"),
      onRemove: () => {
        setNewSince(null)
        setPage(1)
      },
    })
  function clearAllFilters() {
    setPreset('all')
    setRecentOnly(false)
    setTimeRange(null)
    setDueOnly(false)
    setHideExpired(false)
    setHideSeen(false)
    setCities([])
    setEduFilter('')
    setCompanyTypes([])
    setSearchInput('')
    setKeyword('')
    setNewSince(null)
    setPage(1)
  }

  const sortedItems = useMemo(() => {
    if (!data) return []
    if (!sort) return data.items
    const field = (j: CampusJob) =>
      sort.key === 'company'
        ? j.company
        : sort.key === 'deadline'
          ? (isLongTermDate(j.deadline_date) ? null : j.deadline_date)
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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 shrink-0 text-xs text-muted-foreground md:hidden">{t("企业类型")}</span>
      {filters.company_types.slice(0, 6).map((t) => (
        <button
          key={t}
          onClick={() => toggleCompanyType(t)}
          className={cn(
            'min-h-11 rounded-md px-2.5 py-1 text-xs transition-colors md:min-h-0',
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
    <div className="relative">
      <div className="scrollbar-none -mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        <div className="flex w-max items-center gap-1.5">
          <span className="mr-0.5 shrink-0 text-xs text-muted-foreground">{t("城市")}</span>
          {CITY_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCities((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
                setPage(1)
              }}
              className={cn(
                'min-h-11 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs transition-colors md:min-h-0',
                cities.includes(c)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              {c}
            </button>
          ))}
          {cityOptions.length > 0 && (
            <MultiSelect
              label={t("更多城市")}
              options={cityGroups ? undefined : cityOptions}
              groups={cityGroups ?? undefined}
              selected={cities}
              onChange={(v) => {
                setCities(v)
                setPage(1)
              }}
              placeholder={t("搜索城市（支持拼音）…")}
              triggerLabel={
                cities.filter((c) => !CITY_CHIPS.includes(c)).length
                  ? tt`更多城市 · ${cities.filter((c) => !CITY_CHIPS.includes(c)).length}`
                  : t("更多城市")
              }
            />
          )}
        </div>
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 -right-4 w-8 bg-gradient-to-l from-popover to-transparent md:hidden"
        aria-hidden
      />
    </div>
  )

  const eduRow = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{t("我的学历（含可投的「及以上/不限」）：")}</span>
      {EDU_OPTIONS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => {
            setEduFilter((v) => (v === e ? '' : e))
            setPage(1)
          }}
          className={cn(
            'min-h-11 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs transition-colors md:min-h-0',
            eduFilter === e
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {t(e)}
        </button>
      ))}
    </div>
  )

  const quickToggleRow = (
    <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setRecentOnly((v) => !v)
            setPage(1)
          }}
          className={cn(
            'min-h-11 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs transition-colors md:min-h-0',
            recentOnly
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background text-foreground hover:bg-muted',
          )}
        >
          {t("近7天更新")}{' '}</button>
        <button
          type="button"
          onClick={() => {
            setDueOnly((v) => !v)
            setPage(1)
          }}
          className={cn(
            'min-h-11 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs transition-colors md:min-h-0',
            dueOnly
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background text-foreground hover:bg-muted',
          )}
        >
          {t("即将截止")}{' '}</button>
        <button
          type="button"
          onClick={() => {
            setHideExpired((v) => !v)
            setPage(1)
          }}
          className={cn(
            'min-h-11 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs transition-colors md:min-h-0',
            hideExpired
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background text-foreground hover:bg-muted',
          )}
        >
          {t("隐藏已截止")}{' '}</button>
        <button
          type="button"
          onClick={() => setHideSeen((v) => !v)}
          className={cn(
            'min-h-11 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs transition-colors md:min-h-0',
            hideSeen
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background text-foreground hover:bg-muted',
          )}
        >
          {t("隐藏已看过")}{' '}</button>
    </div>
  )

  const mobileFilterCount =
    companyTypes.length +
    cities.length +
    (eduFilter ? 1 : 0) +
    (recentOnly ? 1 : 0) +
    (timeRange ? 1 : 0) +
    (dueOnly ? 1 : 0) +
    (hideExpired ? 1 : 0) +
    (hideSeen ? 1 : 0)

  return (
    <div className="space-y-4">
      <NewSinceBanner
        board="campus"
        onApply={(since) => {
          setNewSince(since)
          setPage(1)
        }}
      />
      {/* 预设视图 chips */}
      <div className="scrollbar-none -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2 sm:w-full sm:flex-wrap">
          {PRESETS.map((v) => (
            <button
              key={v.key}
              onClick={() => selectPreset(v.key)}
              className={cn(
                'min-h-11 whitespace-nowrap rounded-md border px-3.5 py-1.5 text-sm transition-colors sm:min-h-9',
                preset === v.key
                  ? 'border-primary bg-primary/10 text-primary'
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
              <span className="my-auto shrink-0 text-xs text-muted-foreground">{t("去其他板块")}</span>
              {crossPresets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onCrossPreset(p.key)}
                  className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-border bg-background px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-h-9"
                >
                  {p.label}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
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
            {crossLabel || t("另一板块")}{t("中另有")}{' '}
            <span className="font-semibold text-foreground">{crossTotal.toLocaleString()}</span> {' '}{t("条与「")}{' '}{keyword.trim()}{t("」相关，点击查看 →")}{' '}</span>
        </button>
      )}

      <MatchByProfileButton board="campus" onOpenDetail={(j) => setDetail(j as CampusJob)} />

      <BoardRecommendSection
        board="campus"
        onOpenDetail={(j) => setDetail(j as CampusJob)}
      />

      <SavedFilterBar
        board="campus"
        snapshot={filterSnapshot}
        defaultName={filterDefaultName}
        canSave={filterCanSave}
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
          suggestBoard="campus"
          placeholder={t("搜索公司 / 岗位 / 行业 / 专业…")}
          inputClassName="h-10"
        />
        <div className="flex gap-1">
          <button
            type="button"
            aria-label={t("卡片视图")}
            onClick={() => selectView('card')}
            className={cn(
              'inline-flex h-10 w-10 items-center justify-center rounded-md border transition-colors',
              view === 'card'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("表格视图")}
            onClick={() => selectView('table')}
            className={cn(
              'inline-flex h-10 w-10 items-center justify-center rounded-md border transition-colors',
              view === 'table'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            <Table2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("地图分布")}
            title={t("岗位城市分布地图")}
            aria-pressed={mapOpen}
            onClick={() =>
              setMapOpen((v) => {
                if (!v) setTimelineOpen(false)
                return !v
              })
            }
            className={cn(
              'inline-flex h-10 w-10 items-center justify-center rounded-md border transition-colors',
              mapOpen
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            <MapIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("时间线")}
            title={t("岗位更新时间线")}
            aria-pressed={timelineOpen}
            onClick={() =>
              setTimelineOpen((v) => {
                if (!v) setMapOpen(false)
                return !v
              })
            }
            className={cn(
              'inline-flex h-10 w-10 items-center justify-center rounded-md border transition-colors',
              timelineOpen
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            <ChartColumn className="h-4 w-4" />
          </button>
          {view === 'card' && (
            <select
              aria-label={t("排序")}
              value={sort ? `${sort.key}:${sort.dir}` : ''}
              onChange={(e) => {
                const v = e.target.value
                if (!v) setSort(null)
                else {
                  const [key, dir] = v.split(':')
                  setSort({ key, dir: dir as 'asc' | 'desc' })
                }
              }}
              className="ml-1 h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="">{t("默认排序")}</option>
              <option value="updated:desc">{t("更新最新")}</option>
              <option value="deadline:asc">{t("截止最近")}</option>
              <option value="start:desc">{t("开始最新")}</option>
            </select>
          )}
        </div>
        {typeChips && <div className="hidden md:block">{typeChips}</div>}
      </div>

      {synAdded.length > 0 && <SynonymHint added={synAdded} onClose={() => setSynOff(true)} />}

      {timelineOpen && (
        <div className="rounded-lg border border-border bg-card p-2 sm:p-3">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-sm font-medium">{t("岗位更新时间线（每日更新岗位数，拖动下方滑块选时间段）")}</span>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setTimelineOpen(false)}
            >
              {t("收起")}{' '}</button>
          </div>
          <Suspense fallback={<Skeleton className="h-[280px] w-full" />}>
            {timeline ? (
              <TimelinePanel
                days={timeline.days}
                range={timeRange}
                onApplyRange={(from, to) => {
                  setTimeRange({ from, to })
                  setRecentOnly(false)
                  setPage(1)
                }}
                onClearRange={() => {
                  setTimeRange(null)
                  setPage(1)
                }}
              />
            ) : (
              <Skeleton className="h-[280px] w-full" />
            )}
          </Suspense>
        </div>
      )}

      {mapOpen && (
        <div className="rounded-lg border border-border bg-card p-2 sm:p-3">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-sm font-medium">{t("岗位城市分布（气泡大小=岗位数，点击气泡筛选该城市，可拖拽/缩放）")}</span>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setMapOpen(false)}
            >
              {t("收起")}{' '}</button>
          </div>
          <Suspense fallback={<Skeleton className="h-[420px] w-full sm:h-[520px]" />}>
            <CityMapPanel
              cities={cityCounts}
              selected={cities}
              onSelectCity={(c) => {
                setCities((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
                setPage(1)
              }}
            />
          </Suspense>
        </div>
      )}

      {/* 城市筛选 + 近7天更新（桌面） */}
      <div className="hidden space-y-2 md:block">
        {cityFilterRow}
        {eduRow}
        {quickToggleRow}
      </div>

      {/* 移动端筛选：超两行自动折叠 */}
      <MobileFilterCollapse count={mobileFilterCount} title={t("校招筛选")} onReset={clearAllFilters}>
        {typeChips}
        {cityFilterRow}
        {eduRow}
        {quickToggleRow}
      </MobileFilterCollapse>

      {/* 计数 + 导出 */}
      {data && (
        <div ref={listTopRef} className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            {t("共")}{' '}<span className="font-medium text-foreground">{data.total.toLocaleString()}</span> {' '}{t("条")}{' '}</span>
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
        <div className="text-xs text-muted-foreground">{t("本页已隐藏")}{' '}{hiddenSeenCount} {' '}{t("条已看过的岗位")}</div>
      )}

      {/* 列表 */}
      <PullToRefresh
        onRefresh={() =>
          new Promise<void>((resolve) => {
            refreshResolveRef.current = resolve
            setRefreshNonce((n) => n + 1)
          })
        }
        refreshing={loading}
      >
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
            title={t("没有匹配的校招信息")}
            description={t("建议优先移除关键词，其次城市、企业类型筛选")}
            action={
              <div className="flex flex-col items-center gap-3">
                <ActiveFilterChips filters={activeFilters} />
                <SubscribeFilterHint
                  canSave={filterCanSave}
                  onSubscribe={() =>
                    saveQuery('campus', filterDefaultName, new URLSearchParams(filterSnapshot).toString())
                  }
                />
                <HotSearchPills
                  words={HOT_SEARCHES_CAMPUS}
                  onPick={(w) => {
                    setSearchInput(w)
                    setKeyword(w)
                    setPage(1)
                  }}
                />
              </div>
            }
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
                  <span className="sr-only">{t("收藏")}</span>
                </TableHead>
                <SortableHead
                  label={t("公司")}
                  sortKey="company"
                  sort={sort}
                  onToggle={toggleSort}
                  className="min-w-[140px] max-sm:sticky max-sm:left-0 max-sm:z-10 max-sm:border-r max-sm:bg-card max-sm:shadow-[8px_0_12px_-6px_rgba(0,0,0,0.18)]"
                />
                <TableHead>{t("企业类型")}</TableHead>
                <TableHead className="min-w-[220px]">{t("招聘岗位")}</TableHead>
                <TableHead>{t("批次")}</TableHead>
                <TableHead>{t("届次")}</TableHead>
                <TableHead>{t("学历要求")}</TableHead>
                <TableHead>{t("笔试")}</TableHead>
                <TableHead className="hidden 2xl:table-cell">{t("行业")}</TableHead>
                <TableHead className="min-w-[120px]">{t("工作地点")}</TableHead>
                <SortableHead label={t("开始时间")} sortKey="start" sort={sort} onToggle={toggleSort} className="hidden 2xl:table-cell" />
                <SortableHead label={t("截止时间")} sortKey="deadline" sort={sort} onToggle={toggleSort} />
                <SortableHead label={t("更新日期")} sortKey="updated" sort={sort} onToggle={toggleSort} />
                <TableHead>{t("内推码")}</TableHead>
                <TableHead className="sm:sticky sm:right-0 sm:z-10 sm:border-l sm:bg-card sm:shadow-[-8px_0_12px_-6px_rgba(0,0,0,0.18)]">
                  {t("投递/公告")}{' '}</TableHead>
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
                  {!dueOnly && !hideExpired && !sort && !kwTrim && i > 0 &&
                    isExpiredDate(job.deadline_date) && !isExpiredDate(arr[i - 1].deadline_date) && (
                      <ExpiredDividerRow
                        onHide={() => {
                          setHideExpired(true)
                          setPage(1)
                        }}
                      />
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
                  <TableCell
                    className="font-medium max-sm:sticky max-sm:left-0 max-sm:z-10 max-sm:max-w-[150px] max-sm:truncate max-sm:border-r max-sm:bg-card max-sm:shadow-[8px_0_12px_-6px_rgba(0,0,0,0.18)]"
                    title={job.company ?? ''}
                  >
                    <Highlight text={job.company} query={keyword} />
                    <NewDot board="campus" id={job.id} createdAt={job.created_at} className="ml-1.5" />
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
                    {normalizeDateStr(job.start_date) || '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    <span
                      className="inline-flex items-center gap-1.5"
                      title={job.deadline_date ? job.deadline_text ?? undefined : undefined}
                    >
                      {isLongTermDate(job.deadline_date)
                        ? null
                        : job.deadline_date || job.deadline_text || '-'}
                      <DueBadge date={job.deadline_date} />
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {normalizeDateStr(job.updated_at_src) || '-'}
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
                  <TableCell className="sm:sticky sm:right-0 sm:z-10 sm:border-l sm:bg-card sm:shadow-[-8px_0_12px_-6px_rgba(0,0,0,0.18)]">
                    <div className="flex gap-1.5">
                      {job.apply_url && job.apply_url.startsWith('http') && (
                        <a
                          href={job.apply_url}
                          target="_blank" onClick={(e) => e.stopPropagation()}
                          rel="noopener noreferrer"
                          className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                          {t("投递")}{' '}<ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {job.announce_url && job.announce_url.startsWith('http') && (
                        <a
                          href={job.announce_url}
                          target="_blank" onClick={(e) => e.stopPropagation()}
                          rel="noopener noreferrer"
                          className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2 text-xs font-medium transition-colors hover:bg-muted"
                        >
                          {t("公告")}{' '}<ExternalLink className="h-3 w-3" />
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
              {!dueOnly && !hideExpired && !sort && !kwTrim && i > 0 &&
                isExpiredDate(job.deadline_date) && !isExpiredDate(arr[i - 1].deadline_date) && (
                  <ExpiredDividerBlock
                    onHide={() => {
                      setHideExpired(true)
                      setPage(1)
                    }}
                  />
                )}
            <div
              className={cn(
                'cursor-pointer rounded-xl border bg-background p-4 transition-colors hover:border-primary/20 hover:shadow-md',
                !dueOnly && isExpiredDate(job.deadline_date) && 'opacity-60',
              )}
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
                <NewDot board="campus" id={job.id} createdAt={job.created_at} />
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
                    {t("内推码")}{' '}{job.referral_code.length > 16 ? job.referral_code.slice(0, 16) + '…' : job.referral_code}
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
                  <span className="ml-auto text-xs text-muted-foreground">{t("更新：")}{normalizeDateStr(job.updated_at_src)}</span>
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
                    {t("开始：")}{normalizeDateStr(job.start_date)}
                  </span>
                )}
                {job.deadline_text && !isLongTermDate(job.deadline_date) && (
                  <span className="text-muted-foreground">{t("截止：")}{normalizeDateStr(job.deadline_text)}</span>
                )}
                <DueBadge date={job.deadline_date} />
              </div>
              {job.major_requirement && job.major_requirement.trim() !== '/' && (
                <p className={cn('mt-1.5 line-clamp-2 text-xs text-muted-foreground', cardMore.has(job.id) ? 'block' : 'hidden sm:block')}>
                  {t("专业：")}{job.major_requirement}
                </p>
              )}
              {job.notes && job.notes.trim() !== '/' && (
                <p className={cn('mt-1 line-clamp-2 text-xs text-muted-foreground', cardMore.has(job.id) ? 'block' : 'hidden sm:block')}>
                  {t("备注：")}{job.notes}
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
                  {cardMore.has(job.id) ? t("收起") : t("更多")}
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
                      {t("投递入口")}{' '}<ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {job.announce_url && job.announce_url.startsWith('http') && (
                    <a
                      href={job.announce_url}
                      target="_blank" onClick={(e) => e.stopPropagation()}
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
                    >
                      {t("查看公告")}{' '}<ExternalLink className="h-3.5 w-3.5" />
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
            {t("第")}{' '}{page} / {totalPages} {' '}{t("页")}{' '}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => gotoPage(-1)}>
              {t("上一页")}{' '}</Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => gotoPage(1)}
            >
              {t("下一页")}{' '}</Button>
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
          remindDeadline={getEffectiveDeadline(detail)}
          jobKey={`campus:${detail.id}`}
          expiredNotice={isExpiredDate(detail.deadline_date)}
          {...sheetNavProps(visibleItems, detail, setDetail)}
          basics={[
            { label: t("公司"), value: detail.company },
            { label: t("招聘岗位"), value: detail.positions },
            { label: t("企业类型"), value: detail.company_type },
            { label: t("行业"), value: detail.industry },
            { label: t("批次"), value: detail.batch },
            { label: t("届别"), value: detail.grad_years },
            { label: t("免笔试"), value: detail.no_exam },
            { label: t("内推码"), value: detail.referral_code },
            { label: t("工作地点"), value: detail.locations },
            { label: t("来源"), value: detail.source_table },
            { label: t("备注"), value: detail.notes },
          ]}
          requirements={[
            { label: t("学历要求"), value: detail.edu_requirement },
            { label: t("专业要求"), value: detail.major_requirement },
          ]}
          schedule={[
            { label: t("开始时间"), value: normalizeDateStr(detail.start_date) },
            { label: t("截止时间"), value: normalizeDateStr(detail.deadline_text) },
            { label: t("更新时间"), value: normalizeDateStr(detail.updated_at_src) },
          ]}
          links={[
            { label: t("投递入口"), url: detail.apply_url, checkDead: true },
            { label: t("公告链接"), url: detail.announce_url },
          ]}
          applyWindow={(() => {
            const s = normalizeDateStr(detail.start_date)
            if (!s || !detail.deadline_date) return null
            const start = new Date(`${s}T00:00:00`)
            const end = new Date(`${detail.deadline_date}T00:00:00`)
            return !isNaN(start.getTime()) && !isNaN(end.getTime()) && start.getTime() <= end.getTime()
              ? { start, end }
              : null
          })()}
          prep={{
            examType: [detail.company_type, detail.batch, t("校招")].filter(Boolean).join(' '),
            province: detail.locations?.split(/[、,，;；/\s]/)[0] || null,
            deadline: getEffectiveDeadline(detail),
            icsUid: `campus-${detail.id}`,
            icsSummary: tt`报名截止：${detail.company?.trim() || t("校招岗位")}${detail.positions ? ` ${detail.positions.slice(0, 20)}` : ''}`,
          }}
          related={
            relatedJobs.length > 0
              ? {
                  title: t("同公司其他岗位"),
                  items: relatedJobs.map((j) => ({
                    key: String(j.id),
                    label: j.positions || j.batch || j.company || '-',
                    sub: [j.locations, j.deadline_text ? tt`截止：${normalizeDateStr(j.deadline_text)}` : null]
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
          similar={
            similarJobs.length > 0
              ? {
                  title: t("相似岗位（同行业·同城市）"),
                  items: similarJobs.map((j) => ({
                    key: String(j.id),
                    label: [j.company, j.positions].filter(Boolean).join(' · ') || '-',
                    sub: [j.locations, j.deadline_text ? tt`截止：${normalizeDateStr(j.deadline_text)}` : null]
                      .filter(Boolean)
                      .join(' · '),
                  })),
                  onSelect: (key) => {
                    const hit = similarJobs.find((j) => String(j.id) === key)
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
