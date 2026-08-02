import { TableSwipeHint } from './TableSwipeHint'
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildBianzhiExportUrl,
  createBoardExport,
  fetchBianzhiCounts,
  fetchBianzhiFilters,
  fetchBianzhiJob,
  fetchBianzhiJobs,
  type BianzhiFilterOptions,
  type BianzhiJob,
  type BianzhiParams,
} from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PullToRefresh } from './PullToRefresh'
import { EmptyState } from '@/components/EmptyState'
import { ActiveFilterChips, FilterSummaryBar, type RemovableFilter } from '@/components/ActiveFilterChips'
import { Highlight } from '@/components/Highlight'
import { BoardExportButton } from '@/components/BoardExportButton'
import { TONE_CLASSES, hashTone, type Tone } from '@/lib/badgeColors'
import { cn } from '@/lib/utils'
import { formatDueDayLabel, getEffectiveDeadline, parseDeadlineText } from '@/lib/deadline'
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
import { SeenBadge } from '@/components/SeenBadge'
import { useSeenSet } from '@/lib/viewHistory'
import { BoardCompareButton } from '@/components/BoardCompareButton'
import { CrossBoardZeroHint } from '@/components/CrossBoardZeroHint'
import { SearchSuggestInput } from '@/components/SearchSuggestInput'
import { SavedFilterBar } from '@/components/SavedFilterBar'
import { SubscribeFilterHint } from '@/components/SubscribeFilterHint'
import { SynonymHint } from '@/components/SynonymHint'
import { expandKeyword } from '@/lib/synonyms'
import { addRecentSearch, saveQuery } from '@/lib/storage'
import { MatchByProfileButton } from '@/components/MatchByProfileButton'
import { MobileFilterCollapse } from '@/components/MobileFilterCollapse'
import { BoardRecommendSection } from '@/components/BoardRecommendSection'
import { getProfile, profileUsable } from '@/lib/profile'
import { BoardJobSheet } from '@/components/BoardJobSheet'
import { deriveBianzhiTags } from '@/lib/jobTags'
import { readJobParam } from '@/lib/jobDeepLink'
import { sheetNavProps } from '@/lib/sheetNav'

import { ShareTextButton, buildShareText } from '@/components/ShareTextButton'
import { DueBadge } from '@/components/DueBadge'
import { FreshnessNote } from '@/components/FreshnessNote'
import { SortableHead } from '@/components/SortableHead'
import { cmpNullableStr, nextSort, normalizeDateStr, type SortState } from '@/lib/tableSort'
import { toggleBianzhiFavorite, useBianzhiFavorites } from '@/lib/boardFavorites'
import hrSites from '@/data/hrSites.json'
import { applySeo } from '@/lib/seo'
import { lazyRetry } from '@/lib/lazyRetry'
import { jobShareUrl } from '@/lib/clipboard'

const MajorGuideSheet = lazy(() =>
  lazyRetry(() => import('@/components/MajorGuideSheet').then((m) => ({ default: m.MajorGuideSheet }))),
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

function bianzhiShareText(job: BianzhiJob): string {
  return buildShareText({
    org:
      job.employer ||
      (job.category === '大型联考' ? `${job.province ?? ''}${job.job_type ?? ''}联考` : null),
    title: job.job_type,
    location: job.work_location || job.province,
    deadline: job.deadline_text || job.deadline_date,
    deepLink: jobShareUrl('bianzhi', job.id),
    url: job.announce_url || job.apply_url,
  })
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

function daysAgoStr(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface BianzhiPageProps {
  initialPreset?: string
  initialKeyword?: string
  crossPresets?: { key: string; label: string }[]
  onCrossPreset?: (key: string) => void
  crossLabel?: string
  crossFetchTotal?: (keyword: string) => Promise<number>
  onCrossOpen?: (keyword: string) => void
  onOpenBoardKw?: (board: 'positions' | 'campus' | 'bianzhi', keyword: string) => void
}

export function BianzhiPage({
  initialPreset,
  initialKeyword,
  crossPresets,
  onCrossPreset,
  crossLabel,
  crossFetchTotal,
  onCrossOpen,
  onOpenBoardKw,
}: BianzhiPageProps) {
  const urlQuery = useMemo(() => new URLSearchParams(window.location.search), [])
  const [preset, setPreset] = useState(
    initialPreset === 'recent7' ? 'all' : initialPreset ?? 'all',
  )
  const [recentOnly, setRecentOnly] = useState(initialPreset === 'recent7')
  const [dueOnly, setDueOnly] = useState(urlQuery.get('due') === '7')
  const [hideExpired, setHideExpired] = useState(
    urlQuery.get('board') === 'bianzhi' && urlQuery.get('hexp') === '1',
  )
  const [hideSeen, setHideSeen] = useState(
    urlQuery.get('board') === 'bianzhi' && urlQuery.get('hseen') === '1',
  )
  const seenSet = useSeenSet()
  const [eduFilter, setEduFilter] = useState(
    urlQuery.get('board') === 'bianzhi' ? urlQuery.get('bedu') ?? '' : '',
  )
  const [provinceCounts, setProvinceCounts] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    let alive = true
    fetchBianzhiCounts().then((c) => {
      if (!alive || !c) return
      const acc: Record<string, number> = {}
      for (const [key, n] of Object.entries(c.provinces)) {
        for (const part of key.split(/[|,，]/)) {
          const prov = part.trim()
          if (prov) acc[prov] = (acc[prov] ?? 0) + n
        }
      }
      setProvinceCounts(acc)
    })
    return () => {
      alive = false
    }
  }, [])
  const [keyword, setKeyword] = useState(initialKeyword ?? urlQuery.get('bkw') ?? '')
  const [searchInput, setSearchInput] = useState(initialKeyword ?? urlQuery.get('bkw') ?? '')

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
  const [provinces, setProvinces] = useState<string[]>(() => {
    const v = urlQuery.get('prov')
    return v ? v.split(',').filter(Boolean) : []
  })
  const [page, setPage] = useState(1)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const refreshResolveRef = useRef<(() => void) | null>(null)
  const [crossTotal, setCrossTotal] = useState(0)
  const [synOff, setSynOff] = useState(false)
  const [data, setData] = useState<{ total: number; items: BianzhiJob[] } | null>(null)
  const [filters, setFilters] = useState<BianzhiFilterOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const bianzhiFavorites = useBianzhiFavorites()
  const [showHrSites, setShowHrSites] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [view, setView] = useState<'table' | 'card'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'card' : 'table',
  )
  const [sort, setSort] = useState<SortState | null>(null)
  const [detail, setDetail] = useState<BianzhiJob | null>(null)
  const [profileMatched, setProfileMatched] = useState(() => {
    const p = getProfile()
    if (!profileUsable(p)) return false
    const q = new URLSearchParams(window.location.search)
    const kw = q.get('bkw') ?? ''
    const prov = (q.get('prov') ?? '').split(',').filter(Boolean)
    if (!kw && !prov.length) return false
    if (kw !== p.major.trim()) return false
    return prov.every((v) =>
      p.location.some((loc) => loc === v || loc.startsWith(v) || v.startsWith(loc)),
    )
  })
  const deepLinkDone = useRef(false)
  const toggleSort = useCallback((key: string) => setSort((s) => nextSort(s, key)), [])

  useEffect(() => {
    fetchBianzhiFilters().then(setFilters).catch(console.error)
  }, [])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('board') !== 'bianzhi') return
    q.set('bpreset', recentOnly && preset === 'all' ? 'recent7' : preset)
    if (dueOnly) q.set('due', '7')
    else q.delete('due')
    if (hideExpired) q.set('hexp', '1')
    else q.delete('hexp')
    if (hideSeen) q.set('hseen', '1')
    else q.delete('hseen')
    if (provinces.length) q.set('prov', provinces.join(','))
    else q.delete('prov')
    if (keyword.trim()) q.set('bkw', keyword.trim())
    else q.delete('bkw')
    if (eduFilter) q.set('bedu', eduFilter)
    else q.delete('bedu')
    window.history.replaceState(null, '', `?${q.toString()}${window.location.hash}`)
    applySeo('bianzhi', preset)
  }, [preset, recentOnly, dueOnly, hideExpired, hideSeen, provinces, keyword, eduFilter])

  const isLiankaoPreset = preset === 'lk'
  const fetchPage = isLiankaoPreset ? 1 : page

  const kwTrim = keyword.trim()
  useEffect(() => {
    setSynOff(false)
  }, [kwTrim])
  const synAdded = useMemo(
    () => (synOff || !kwTrim ? [] : expandKeyword(kwTrim).added),
    [kwTrim, synOff],
  )

  const params = useMemo<BianzhiParams>(() => {
    const cat = PRESETS.find((v) => v.key === preset)?.category
    return {
      category: cat ? [cat] : undefined,
      province: provinces.length ? provinces : undefined,
      keyword: kwTrim ? (synAdded.length ? expandKeyword(kwTrim).expanded : kwTrim) : undefined,
      edu: eduFilter || undefined,
      updated_after: recentOnly ? daysAgoStr(7) : undefined,
      due_within_days: dueOnly ? 7 : undefined,
      hide_expired: !dueOnly && hideExpired ? true : undefined,
      page: fetchPage,
      page_size: isLiankaoPreset ? 100 : PAGE_SIZE,
    }
  }, [preset, recentOnly, kwTrim, synAdded, provinces, dueOnly, hideExpired, fetchPage, isLiankaoPreset, eduFilter])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    const load = async () => {
      const first = await fetchBianzhiJobs(params, controller.signal)
      const items = [...first.items]
      if (params.page_size === 100) {
        let p = 2
        while (items.length < first.total && p <= 10) {
          const res = await fetchBianzhiJobs({ ...params, page: p }, controller.signal)
          if (!res.items.length) break
          items.push(...res.items)
          p += 1
        }
      }
      if (cancelled) return
      setData({ total: first.total, items })
      if (!deepLinkDone.current) {
        deepLinkDone.current = true
        const id = readJobParam('bianzhi')
        if (id) {
          const hit = items.find((j) => j.id === id)
          if (hit) setDetail(hit)
          else {
            fetchBianzhiJob(id)
              .then((job) => {
                if (!cancelled) setDetail(job)
              })
              .catch(() => undefined)
          }
        }
      }
    }
    load()
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

  const toggleProvince = useCallback((p: string) => {
    setProvinces((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
    setPage(1)
  }, [])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  /** 导出文件名：板块+筛选摘要+日期 */
  const exportFname = useMemo(() => {
    const presetLabel = PRESETS.find((v) => v.key === preset)?.label
    const parts = [
      '编制',
      preset !== 'all' ? presetLabel : undefined,
      ...provinces,
      keyword || undefined,
      eduFilter || undefined,
      recentOnly ? '近7天' : undefined,
      dueOnly ? '7天内截止' : undefined,
      !dueOnly && hideExpired ? '未过期' : undefined,
      new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    ]
    return parts.filter(Boolean).join('-')
  }, [preset, provinces, keyword, eduFilter, recentOnly, dueOnly, hideExpired])
  const isLiankao = isLiankaoPreset

  const filterSnapshot = (() => {
    const s: Record<string, string> = {}
    if (recentOnly && preset === 'all') s.bpreset = 'recent7'
    else if (preset !== 'all') s.bpreset = preset
    if (dueOnly) s.due = '7'
    if (provinces.length) s.prov = provinces.join(',')
    if (keyword.trim()) s.bkw = keyword.trim()
    return s
  })()
  const filterDefaultName =
    [
      provinces[0],
      preset !== 'all' ? PRESETS.find((p) => p.key === preset)?.label : null,
      dueOnly ? '即将截止' : null,
      keyword.trim() || null,
    ]
      .filter(Boolean)
      .join('·') || '编制筛选'
  const filterCanSave =
    preset !== 'all' || recentOnly || dueOnly || provinces.length > 0 || !!keyword.trim()

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
  for (const p of provinces)
    activeFilters.push({ label: `省份：${p}`, onRemove: () => toggleProvince(p) })
  if (preset !== 'all') {
    const presetLabel = PRESETS.find((v) => v.key === preset)?.label
    if (presetLabel)
      activeFilters.push({ label: `分类：${presetLabel}`, onRemove: () => selectPreset('all') })
  }
  if (eduFilter)
    activeFilters.push({
      label: `学历：${eduFilter}`,
      onRemove: () => {
        setEduFilter('')
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
  if (recentOnly)
    activeFilters.push({
      label: '近7天更新',
      onRemove: () => {
        setRecentOnly(false)
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
        setProvinces([])
        setPage(1)
        setProfileMatched(false)
      },
    })

  function clearAllFilters() {
    selectPreset('all')
    setEduFilter('')
    setRecentOnly(false)
    setDueOnly(false)
    setHideExpired(false)
    setHideSeen(false)
    setProvinces([])
    setSearchInput('')
    setKeyword('')
    setProfileMatched(false)
    setPage(1)
  }

  const bianzhiSuggestWords = useMemo(
    () => [
      ...PRESETS.filter((p) => p.category).map((p) => p.category as string),
      '教师招聘',
      '医院',
      '事业编',
      ...(filters?.provinces ?? []),
    ],
    [filters],
  )

  const liankaoInfo = useMemo(() => {
    if (!isLiankao || !data) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const withDate = data.items.map((j) => ({ j, d: parseDeadlineText(j.exam_time) }))
    const items = [...withDate]
      .sort((a, b) => {
        if (!a.d && !b.d) return 0
        if (!a.d) return 1
        if (!b.d) return -1
        return a.d.getTime() - b.d.getTime()
      })
      .map((x) => x.j)
    const upcoming = withDate
      .filter((x): x is { j: BianzhiJob; d: Date } => !!x.d && x.d.getTime() >= today.getTime())
      .sort((a, b) => a.d.getTime() - b.d.getTime())[0]
    if (!upcoming) return { items, banner: null }
    const days = Math.round((upcoming.d.getTime() - today.getTime()) / 86400000)
    const name =
      upcoming.j.employer ||
      `${upcoming.j.province ?? ''}${upcoming.j.job_type ?? ''}联考`.trim() ||
      '联考'
    return { items, banner: { name, days } }
  }, [isLiankao, data])

  const sortedItems = useMemo(() => {
    if (!data) return []
    if (liankaoInfo && !sort) return liankaoInfo.items
    if (!sort) return data.items
    const field = (j: BianzhiJob) =>
      sort.key === 'employer'
        ? j.employer
        : sort.key === 'deadline'
          ? j.deadline_date
          : normalizeDateStr(j.updated_at_src)
    return [...data.items].sort((a, b) => cmpNullableStr(field(a), field(b), sort.dir))
  }, [data, sort, liankaoInfo])

  const pageItems = useMemo(() => {
    const items = isLiankao
      ? sortedItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
      : sortedItems
    return hideSeen ? items.filter((j) => !seenSet.has(`bianzhi:${j.id}`)) : items
  }, [isLiankao, sortedItems, page, hideSeen, seenSet])
  const hiddenSeenCount =
    (isLiankao ? Math.min(PAGE_SIZE, Math.max(0, sortedItems.length - (page - 1) * PAGE_SIZE)) : sortedItems.length) -
    pageItems.length

  const [relatedJobs, setRelatedJobs] = useState<BianzhiJob[]>([])

  useEffect(() => {
    const employer = detail?.employer?.trim()
    const detailId = detail?.id
    if (!employer) {
      setRelatedJobs([])
      return
    }
    let cancelled = false
    fetchBianzhiJobs({ keyword: employer, page: 1, page_size: 20 })
      .then((res) => {
        if (cancelled) return
        setRelatedJobs(
          res.items
            .filter((j) => j.id !== detailId && (j.employer ?? '').trim() === employer)
            .slice(0, 5),
        )
      })
      .catch(() => {
        if (!cancelled) setRelatedJobs([])
      })
    return () => {
      cancelled = true
    }
  }, [detail?.employer, detail?.id])

  const [cardMore, setCardMore] = useState<Set<number>>(new Set())
  const toggleCardMore = useCallback((id: number) => {
    setCardMore((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const provinceRow =
    filters && filters.provinces.length > 0 ? (
      <div className="scrollbar-none -mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        <div className="flex w-max gap-1.5">
          {filters.provinces.slice(0, 32).map((p) => (
            <button
              key={p}
              onClick={() => toggleProvince(p)}
              className={cn(
                'min-h-11 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors md:min-h-0',
                provinces.includes(p)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {p}
              {provinceCounts?.[p] != null && (
                <span className="ml-1 hidden sm:inline">
                  {provinceCounts[p].toLocaleString()}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    ) : null

  return (
    <div className="space-y-4">
      {/* 分类 chips */}
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
              {filters && v.category && (
                <span className="ml-1 text-xs">
                  {(filters.categories[v.category] ?? 0).toLocaleString()}
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setRecentOnly((v) => !v)
              setPage(1)
            }}
            className={cn(
              'min-h-11 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors sm:min-h-9',
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
              'min-h-11 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors sm:min-h-9',
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
              'min-h-11 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors sm:min-h-9',
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
              'min-h-11 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors sm:min-h-9',
              hideSeen
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
          >
            隐藏已看过
          </button>
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
        note="按省份+专业匹配（编制无学历字段，已跳过该维度）"
        active={profileMatched}
        onApply={(p) => {
          const kw = p.major.trim()
          setSearchInput(kw)
          setKeyword(kw)
          const opts = filters?.provinces ?? []
          const provs = p.location
            .map((loc) => opts.find((o) => o === loc || loc.startsWith(o) || o.startsWith(loc)))
            .filter((v): v is string => !!v)
          setProvinces([...new Set(provs)])
          setPage(1)
          setProfileMatched(true)
        }}
        onClear={() => {
          setSearchInput('')
          setKeyword('')
          setProvinces([])
          setPage(1)
          setProfileMatched(false)
        }}
      />

      <BoardRecommendSection
        board="bianzhi"
        onOpenDetail={(j) => setDetail(j as BianzhiJob)}
      />

      <SavedFilterBar
        board="bianzhi"
        snapshot={filterSnapshot}
        defaultName={filterDefaultName}
        canSave={filterCanSave}
      />

      {/* 搜索 + 省份 */}
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
          words={bianzhiSuggestWords}
          placeholder="搜索招聘单位 / 工作地 / 专业…"
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
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-11 gap-1.5 sm:h-10" onClick={() => setGuideOpen(true)}>
            <GraduationCap className="h-4 w-4" />
            专业就业方向
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 gap-1.5 sm:h-10"
            onClick={() => setShowHrSites((v) => !v)}
          >
            <Landmark className="h-4 w-4" />
            各省人社官网
          </Button>
        </div>
      </div>

      {synAdded.length > 0 && <SynonymHint added={synAdded} onClose={() => setSynOff(true)} />}

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
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted sm:min-h-0"
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

      {/* 省份 chips（桌面） */}
      {provinceRow && <div className="hidden md:block">{provinceRow}</div>}

      {/* 移动端筛选：超两行自动折叠 */}
      {provinceRow && (
        <MobileFilterCollapse count={provinces.length} title="编制筛选">
          {provinceRow}
        </MobileFilterCollapse>
      )}

      {/* 计数 + 导出 */}
      {data && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            共 <span className="font-medium text-foreground">{data.total.toLocaleString()}</span> 条
          </span>
          <FreshnessNote board="bianzhi" />
          <BoardExportButton
            className="ml-auto"
            total={data.total}
            buildSyncUrl={() => buildBianzhiExportUrl(params, exportFname)}
            startAsync={(maxRows) => createBoardExport('bianzhi', params, exportFname, maxRows)}
          />
        </div>
      )}

      {liankaoInfo?.banner && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium',
            liankaoInfo.banner.days <= 7
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300'
              : 'border-primary/20 bg-primary/5 text-primary',
          )}
        >
          <Landmark className="h-4 w-4 shrink-0" />
          距 {liankaoInfo.banner.name} 还有{' '}
          {liankaoInfo.banner.days === 0 ? '不到 1 天（今日开考）' : `${liankaoInfo.banner.days} 天`}
        </div>
      )}

      <FilterSummaryBar filters={activeFilters} onClearAll={clearAllFilters} />

      {hideSeen && hiddenSeenCount > 0 && (
        <div className="text-xs text-muted-foreground">本页已隐藏 {hiddenSeenCount} 条已看过的岗位</div>
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
            title="没有匹配的编制公告"
            description="建议优先移除关键词，其次省份、分类筛选"
            action={
              <div className="flex flex-col items-center gap-3">
                <ActiveFilterChips filters={activeFilters} />
                <SubscribeFilterHint
                  canSave={filterCanSave}
                  onSubscribe={() =>
                    saveQuery('bianzhi', filterDefaultName, new URLSearchParams(filterSnapshot).toString())
                  }
                />
              </div>
            }
          />
          {keyword.trim() && onOpenBoardKw && (
            <CrossBoardZeroHint from="bianzhi" keyword={keyword} onOpen={onOpenBoardKw} />
          )}
        </div>
      ) : view === 'card' ? (
        <div className={cn('space-y-2', loading && 'pointer-events-none opacity-60')}>
          {pageItems.map((job, i, arr) => (
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
                  active={bianzhiFavorites.some((f) => f.id === job.id)}
                  onToggle={() => toggleBianzhiFavorite(job)}
                />
                <BoardCompareButton className="-ml-1 -my-1" item={{ board: 'bianzhi', job }} />
                <ShareTextButton className="-ml-1 -my-1" text={bianzhiShareText(job)} />
                <span className="text-base font-semibold">
                  <Highlight
                    text={
                      job.employer ||
                      (job.category === '大型联考'
                        ? `${job.province ?? ''}${job.job_type ?? ''}联考`
                        : '-')
                    }
                    query={keyword}
                  />
                </span>
                <SeenBadge board="bianzhi" id={job.id} />
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
                  <span className="text-muted-foreground">
                    招 {job.headcount}
                    {/[人名]$/.test(String(job.headcount)) ? '' : ' 人'}
                  </span>
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
                {!isLiankao && <DueBadge date={job.deadline_date} />}
                {deriveBianzhiTags(job).map((t) => (
                  <Badge key={t.key} variant="secondary" className="border-0 bg-muted font-normal text-foreground/80 dark:text-muted-foreground">
                    {t.label}
                  </Badge>
                ))}
              </div>
              {job.major_requirement && job.major_requirement.trim() !== '/' && (
                <p
                  title={job.major_requirement}
                  className={cn('mt-1.5 text-xs text-muted-foreground', cardMore.has(job.id) ? 'block whitespace-pre-wrap' : 'hidden sm:line-clamp-2')}
                >
                  专业：{job.major_requirement}
                </p>
              )}
              {job.notes && job.notes.trim() !== '/' && (
                <p
                  title={job.notes}
                  className={cn('mt-1 text-xs text-muted-foreground', cardMore.has(job.id) ? 'block whitespace-pre-wrap' : 'hidden sm:line-clamp-2')}
                >
                  备注：{job.notes}
                </p>
              )}
              {((job.major_requirement && job.major_requirement.trim() !== '/') ||
                (job.notes && job.notes.trim() !== '/')) && (
                <button
                  type="button"
                  className="mt-1 flex min-h-11 items-center text-xs text-muted-foreground underline-offset-2 hover:underline sm:min-h-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleCardMore(job.id)
                  }}
                >
                  {cardMore.has(job.id) ? '收起' : '展开全文'}
                </button>
              )}
              {(job.announce_url || job.apply_url) && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {job.announce_url && job.announce_url.startsWith('http') && (
                    <a
                      href={job.announce_url}
                      target="_blank" onClick={(e) => e.stopPropagation()}
                      rel="noopener noreferrer"
                      className="inline-flex h-11 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:h-8"
                    >
                      查看公告 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {job.apply_url && job.apply_url.startsWith('http') && (
                    <a
                      href={job.apply_url}
                      target="_blank" onClick={(e) => e.stopPropagation()}
                      rel="noopener noreferrer"
                      className="inline-flex h-11 items-center gap-1 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted sm:h-8"
                    >
                      报名入口 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
            </Fragment>
          ))}
        </div>
      ) : (
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
                  label="招聘单位 / 公告"
                  sortKey="employer"
                  sort={sort}
                  onToggle={toggleSort}
                  className="min-w-[260px]"
                />
                <TableHead>分类</TableHead>
                <TableHead>省份</TableHead>
                <TableHead className="min-w-[110px]">工作地</TableHead>
                <TableHead>类型</TableHead>
                <TableHead className="hidden 2xl:table-cell">人数</TableHead>
                <TableHead>学历要求</TableHead>
                <TableHead className="min-w-[160px]">专业/学科</TableHead>
                {isLiankao ? (
                  <>
                    <TableHead>报名开始</TableHead>
                    <TableHead>考试时间</TableHead>
                  </>
                ) : (
                  <SortableHead
                    label="截止时间"
                    sortKey="deadline"
                    sort={sort}
                    onToggle={toggleSort}
                    className="min-w-[140px]"
                  />
                )}
                <SortableHead label="更新时间" sortKey="updated" sort={sort} onToggle={toggleSort} className="hidden 2xl:table-cell" />
                <TableHead className="sticky right-0 z-10 border-l bg-card shadow-[-8px_0_12px_-6px_rgba(0,0,0,0.18)]">
                  链接
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((job, i, arr) => (
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
                        active={bianzhiFavorites.some((f) => f.id === job.id)}
                        onToggle={() => toggleBianzhiFavorite(job)}
                      />
                      <BoardCompareButton item={{ board: 'bianzhi', job }} />
                      <ShareTextButton text={bianzhiShareText(job)} />
                    </div>
                  </TableCell>
                  <TableCell className="font-medium" title={job.employer ?? ''}>
                    <span className="line-clamp-2 max-w-[380px] whitespace-normal">
                      <Highlight
                        text={
                          job.employer ||
                          (job.category === '大型联考'
                            ? `${job.province ?? ''}${job.job_type ?? ''}联考`
                            : '-')
                        }
                        query={keyword}
                      />
                      <SeenBadge board="bianzhi" id={job.id} className="ml-1.5" />
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
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground 2xl:table-cell" title={job.headcount ?? ''}>
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
                      <span className="inline-flex items-center gap-1.5">
                        {job.deadline_text
                          ? job.deadline_text.length > 14
                            ? job.deadline_text.slice(0, 14) + '…'
                            : job.deadline_text
                          : '-'}
                        <DueBadge date={job.deadline_date} />
                      </span>
                    </TableCell>
                  )}
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground 2xl:table-cell">
                    {job.updated_at_src || '-'}
                  </TableCell>
                  <TableCell className="sticky right-0 z-10 border-l bg-card shadow-[-8px_0_12px_-6px_rgba(0,0,0,0.18)]">
                    <div className="flex gap-1.5">
                      {job.announce_url && job.announce_url.startsWith('http') && (
                        <a
                          href={job.announce_url}
                          target="_blank" onClick={(e) => e.stopPropagation()}
                          rel="noopener noreferrer"
                          className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2 text-xs font-medium text-primary transition-colors hover:bg-muted"
                        >
                          公告 <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {job.apply_url && job.apply_url.startsWith('http') && (
                        <a
                          href={job.apply_url}
                          target="_blank" onClick={(e) => e.stopPropagation()}
                          rel="noopener noreferrer"
                          className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2 text-xs font-medium text-primary transition-colors hover:bg-muted"
                        >
                          报名 <ExternalLink className="h-3 w-3" />
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
          title={
            detail.employer ||
            (detail.category === '大型联考'
              ? `${detail.province ?? ''}${detail.job_type ?? ''}联考`
              : '-')
          }
          badges={[detail.category, detail.province].filter((b): b is string => !!b)}
          tags={deriveBianzhiTags(detail).map((t) => ({
            ...t,
            onClick:
              t.key === 'edu_bk'
                ? () => {
                    setEduFilter('本科')
                    setPage(1)
                    setDetail(null)
                  }
                : undefined,
          }))}
          shareText={bianzhiShareText(detail)}
          favActive={bianzhiFavorites.some((f) => f.id === detail.id)}
          onFavToggle={() => toggleBianzhiFavorite(detail)}
          jobKey={`bianzhi:${detail.id}`}
          prep={{
            examType: detail.category || detail.job_type,
            province: detail.province,
            deadline:
              getEffectiveDeadline(detail),
            icsUid: `bz-${detail.id}`,
            icsSummary: `报名截止：${detail.employer?.trim() || detail.job_type || '编制岗位'}`,
          }}
          {...sheetNavProps(pageItems, detail, setDetail)}
          basics={[
            { label: '招聘单位', value: detail.employer },
            { label: '分类', value: detail.category },
            { label: '省份', value: detail.province },
            { label: '岗位类型', value: detail.job_type },
            { label: '招聘人数', value: detail.headcount },
            { label: '工作地点', value: detail.work_location },
            { label: '备注', value: detail.notes },
          ]}
          requirements={[
            { label: '学历要求', value: detail.edu_requirement },
            { label: '专业要求', value: detail.major_requirement },
          ]}
          schedule={[
            { label: '报名开始', value: detail.signup_start },
            { label: '报名截止', value: detail.deadline_text },
            { label: '考试时间', value: detail.exam_time },
            { label: '更新时间', value: detail.updated_at_src },
          ]}
          links={[
            { label: '公告链接', url: detail.announce_url },
            { label: '报名入口', url: detail.apply_url },
          ]}
          related={
            relatedJobs.length > 0
              ? {
                  title: '同单位其他公告',
                  items: relatedJobs.map((j) => ({
                    key: String(j.id),
                    label: [j.job_type, j.category].filter(Boolean).join(' · ') || j.employer || '-',
                    sub: [j.work_location || j.province, j.deadline_text ? `截止：${j.deadline_text}` : null]
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
