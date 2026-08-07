import { t, tt } from '@/lib/i18n'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import axios from 'axios'
import {
  fetchFilters,
  formatTotal,
  type PositionList,
  type FilterOptions,
  type SearchParams,
} from '@/api'
import { StatsDashboard } from './StatsDashboard'
import { FreshnessNote } from './FreshnessNote'
import { DeadlinesCard } from './DeadlinesCard'
import { TodayGlance } from './TodayGlance'
import { buildShareUrl, paramsFromQueryString, paramsToQueryString, POSITION_URL_KEYS } from '@/lib/urlFilters'
import { isNarrowScreen, readViewPref, setViewPref, useOnNarrowScreen } from '@/lib/viewPref'
import { useSeenSet } from '@/lib/viewHistory'
import { markBoardVisit } from '@/lib/lastVisit'
import { expandKeyword } from '@/lib/synonyms'
import { MultiSelect } from './MultiSelect'
import { getProfile, saveProfile } from '@/lib/profile'
import { ValuePropBanner } from './ValuePropBanner'
import { NewSinceBanner, useNewSinceOnScreen } from './NewSinceBanner'
import type { RecommendQuery } from './RecommendPanel'
import { buildExportUrl, createExport, exportDownloadUrl, fetchExportStatus } from '@/api'
import { LocationFilter } from './LocationFilter'
import {
  addRecentSearch,
  clearRecentSearches,
  deleteFilter,
  getRecentSearches,
  getSavedFilters,
  saveFilter,
  type SavedFilter,
} from '@/lib/storage'
import { pinyinMatch } from '@/lib/pinyin'
import {
  enableNotifyForSavedFilter,
  isNewsNotificationSupported,
  markSavedFilterSeen,
  removeSavedFilterBaseline,
  useSavedNews,
} from '@/lib/savedNews'
import {
  ArrowUpRight,
  Search,
  Filter,
  X,
  RotateCcw,
  LayoutGrid,
  Table2,
  TrendingUp,
  Rows3,
  History,
  BookmarkPlus,
  Bookmark,
  Check,
  Link2,
  Download,
  SlidersHorizontal,
  Loader2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PullToRefresh } from './PullToRefresh'
import { cn } from '@/lib/utils'
import { ActiveFilterChips, FilterSummaryBar, type RemovableFilter } from './ActiveFilterChips'
import { SubscribeFilterHint } from './SubscribeFilterHint'
import { HotSearchPills } from './HotSearchPills'
import { SynonymHint } from './SynonymHint'
import { SearchSuggestInput } from './SearchSuggestInput'
import { RecommendSection } from './RecommendSection'
import { CrossBoardZeroHint } from './CrossBoardZeroHint'
import { lazyRetry } from '@/lib/lazyRetry'

const RecommendPanel = lazy(() =>
  lazyRetry(() => import('./RecommendPanel').then((m) => ({ default: m.RecommendPanel }))),
)
const PositionTable = lazy(() =>
  lazyRetry(() => import('./PositionTable').then((m) => ({ default: m.PositionTable }))),
)
const PositionCardGrid = lazy(() =>
  lazyRetry(() => import('./PositionCardGrid').then((m) => ({ default: m.PositionCardGrid }))),
)
const VirtualPositionList = lazy(() =>
  lazyRetry(() => import('./VirtualPositionList').then((m) => ({ default: m.VirtualPositionList }))),
)

interface ListPageProps {
  title: string
  fetcher: (params: SearchParams, signal?: AbortSignal) => Promise<PositionList>
  showStats?: boolean
  syncUrl?: boolean
  initialPresetKey?: string
  initialKeyword?: string
  initialEduLevel?: string[]
  /** 全站搜索快捷筛选：初始省份/城市（location 标签） */
  initialProvince?: string[]
  initialLocation?: string[]
  crossPresets?: { key: string; label: string }[]
  onCrossPreset?: (key: string) => void
  crossLabel?: string
  crossFetchTotal?: (keyword: string) => Promise<number>
  onCrossOpen?: (keyword: string) => void
  onOpenBoardKw?: (board: 'positions' | 'campus' | 'bianzhi', keyword: string) => void
  onOpenUpdates?: () => void
}

// value 必须保持中文（数据内容为中文，用译文查询会 0 结果）；label 可随语言翻译
const HOT_SEARCH = [
  { label: t("北京"), type: 'location' as const, value: '北京' },
  { label: t("上海"), type: 'location' as const, value: '上海' },
  { label: t("广州"), type: 'location' as const, value: '广州' },
  { label: t("深圳"), type: 'location' as const, value: '深圳' },
  { label: t("杭州"), type: 'location' as const, value: '杭州' },
  { label: t("计算机"), type: 'major' as const, value: '计算机' },
  { label: t("法学"), type: 'major' as const, value: '法学' },
  { label: t("会计"), type: 'major' as const, value: '会计' },
  { label: t("国考"), type: 'keyword' as const, value: '国考' },
  { label: t("央企校招"), type: 'keyword' as const, value: '央企校招' },
]

const POSITION_INDUSTRY_WORDS = [
  '银行',
  '人民银行',
  '税务',
  '海关',
  '铁路',
  '电力',
  '电网',
  '烟草',
  '邮政',
  '公安',
  '法院',
  '检察院',
  '学校',
  '教师',
  '医院',
  '海事',
  '气象',
  '统计',
  '消防',
  '监狱',
  '水利',
  '农业农村',
]

const DEFAULT_PARAMS: SearchParams = {
  page: 1,
  page_size: 20,
  sort: 'year_desc',
  keyword: '',
  year: [],
  job_type: [],
  exam_type: [],
  edu_requirement: [],
  work_location: [],
  location: [],
  edu_level: [],
  major: '',
  major_type: 'any',
  category: [],
}

const SYNC_EXPORT_MAX = 2000
const ASYNC_EXPORT_MAX = 50000

interface PresetView {
  key: string
  label: string
  category?: string[]
  year?: number[]
  deadline?: boolean
}

const PRESET_VIEWS: PresetView[] = [
  { key: 'all', label: t("全部") },
  // category 为查询值，必须保持中文（数据内容为中文，译文查询会 0 结果）
  { key: 'gwy', label: t("公务员"), category: ['公务员'] },
  { key: 'sye', label: t("事业编"), category: ['事业单位/事业编'] },
  { key: 'jdwz', label: t("军队文职"), category: ['军队文职'] },
  { key: 'gqyq', label: t("国企央企"), category: ['国企/央企'] },
  { key: 'xds', label: t("选调生"), category: ['选调生'] },
  { key: 'y2027', label: t("2027 最新"), year: [2027] },
  { key: 'deadline', label: t("即将截止"), deadline: true },
]

type ViewMode = 'table' | 'card' | 'list'

function defaultView(): ViewMode {
  if (isNarrowScreen()) {
    const saved = readViewPref('positions', ['card', 'list'] as const)
    return saved ?? 'card'
  }
  return readViewPref('positions', ['table', 'card', 'list'] as const) ?? 'table'
}

export function ListPage({
  title,
  fetcher,
  showStats,
  syncUrl,
  initialPresetKey,
  initialKeyword,
  initialEduLevel,
  initialProvince,
  initialLocation,
  crossPresets,
  onCrossPreset,
  crossLabel,
  crossFetchTotal,
  onCrossOpen,
  onOpenBoardKw,
  onOpenUpdates,
}: ListPageProps) {
  const [filters, setFilters] = useState<FilterOptions | null>(null)
  const [data, setData] = useState<PositionList | null>(null)
  const [loading, setLoading] = useState(false)
  const [slowLoading, setSlowLoading] = useState(false)
  const [view, setViewState] = useState<ViewMode>(defaultView)
  const setView = useCallback((v: ViewMode) => {
    setViewState(v)
    setViewPref('positions', v)
  }, [])
  useOnNarrowScreen(
    useCallback(() => setViewState((v) => (v === 'table' ? 'card' : v)), []),
  )
  const [filterOpen, setFilterOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [deadlineView, setDeadlineView] = useState(false)
  const newSinceOnScreen = useNewSinceOnScreen()
  /** 移动端搜索工具区（一键匹配/热门/最近/保存的筛选）默认收起，保首屏岗位可见 */
  const [toolsOpen, setToolsOpen] = useState(false)
  const [majorInput, setMajorInput] = useState(() => getProfile().major || '')
  const quickMatchRef = useRef<HTMLInputElement | null>(null)
  const [params, setParams] = useState<SearchParams>(() => {
    const urlBoard = new URLSearchParams(window.location.search).get('board')
    const fromUrl = syncUrl && (!urlBoard || urlBoard === 'positions')
    const base = fromUrl
      ? { ...DEFAULT_PARAMS, ...paramsFromQueryString(window.location.search) }
      : { ...DEFAULT_PARAMS }
    const preset = initialPresetKey
      ? PRESET_VIEWS.find((p) => p.key === initialPresetKey)
      : undefined
    if (preset?.category) base.category = preset.category
    if (preset?.year) base.year = preset.year
    if (initialKeyword) base.keyword = initialKeyword
    if (initialEduLevel?.length) base.edu_level = initialEduLevel
    if (initialProvince?.length) base.province = initialProvince
    if (initialLocation?.length) base.location = initialLocation
    return base
  })
  const [crossTotal, setCrossTotal] = useState(0)
  const [hideSeen, setHideSeen] = useState(
    () => new URLSearchParams(window.location.search).get('hseen') === '1',
  )
  const seenSet = useSeenSet()

  useEffect(() => {
    markBoardVisit('positions')
  }, [])

  useEffect(() => {
    if (!syncUrl) return
    const q = new URLSearchParams(window.location.search)
    const b = q.get('board')
    if (b && b !== 'positions') return
    if (hideSeen) q.set('hseen', '1')
    else q.delete('hseen')
    const qs = q.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
    )
  }, [syncUrl, hideSeen])

  useEffect(() => {
    const kw = (params.keyword || '').trim()
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
  }, [params.keyword, crossFetchTotal])
  const [recent, setRecent] = useState<string[]>(() => getRecentSearches())
  const [saved, setSaved] = useState<SavedFilter[]>(() => getSavedFilters())
  const savedNews = useSavedNews()
  const positionsNewSum = saved.reduce(
    (a, f) => a + (savedNews.counts[`positions|${f.name}`] ?? 0),
    0,
  )
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveHint, setSaveHint] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')
  const [saveNotify, setSaveNotify] = useState(true)
  const [copied, setCopied] = useState(false)
  const [recommendQuery, setRecommendQuery] = useState<RecommendQuery | null>(null)
  const [exportTask, setExportTask] = useState<string | null>(null)
  const [exportError, setExportError] = useState('')
  const [loadError, setLoadError] = useState(false)
  const [synOff, setSynOff] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const loadSeqRef = useRef(0)
  const exportTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (exportTimerRef.current) clearInterval(exportTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!loading) {
      setSlowLoading(false)
      return
    }
    const t = setTimeout(() => setSlowLoading(true), 6000)
    return () => clearTimeout(t)
  }, [loading])

  useEffect(() => {
    fetchFilters().then(setFilters).catch(console.error)
  }, [])

  useEffect(() => {
    if (!syncUrl) return
    const cur = new URLSearchParams(window.location.search)
    const curBoard = cur.get('board')
    if (curBoard && curBoard !== 'positions') return
    const q = new URLSearchParams(paramsToQueryString(params))
    for (const [k, v] of cur) {
      if (!POSITION_URL_KEYS.includes(k)) q.append(k, v)
    }
    const qs = q.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
    )
  }, [syncUrl, params])

  function applySuggestion(text: string) {
    updateParam('keyword', text)
  }

  async function copyShareLink() {
    const url = buildShareUrl(params)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = url
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 3500)
  }

  const kwTrim = (params.keyword || '').trim()
  useEffect(() => {
    setSynOff(false)
  }, [kwTrim])
  const synAdded = useMemo(
    () => (synOff || !kwTrim ? [] : expandKeyword(kwTrim).added),
    [kwTrim, synOff],
  )
  // 同义扩展后的请求参数（列表/导出/无限滚动统一口径）；URL/分享/保存筛选仍用原始关键词
  const effParams = useMemo(
    () =>
      synAdded.length ? { ...params, keyword: expandKeyword(kwTrim).expanded } : params,
    [params, synAdded, kwTrim],
  )

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++loadSeqRef.current
    const isCurrent = () => seq === loadSeqRef.current && !controller.signal.aborted
    setLoading(true)
    setLoadError(false)
    try {
      let res: Awaited<ReturnType<typeof fetcher>>
      try {
        res = await fetcher(effParams, controller.signal)
      } catch (e) {
        // 瞬时网络抖动（status=0 无响应）自动重试一次，减少偶发「加载失败」误报
        if (!isCurrent() || (axios.isAxiosError(e) && e.response)) throw e
        await new Promise((r) => setTimeout(r, 800))
        if (!isCurrent()) return
        res = await fetcher(effParams, controller.signal)
      }
      if (!isCurrent()) return
      setData(res)
      const kw = (params.keyword || '').trim()
      if (kw.length >= 2) setRecent(addRecentSearch(kw))
    } catch (e) {
      if (isCurrent()) {
        console.error(e)
        setLoadError(true)
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [fetcher, effParams, params])

  useEffect(() => {
    if (view === 'list') return
    const t = setTimeout(load, 300)
    return () => {
      clearTimeout(t)
      abortRef.current?.abort()
    }
  }, [load, view])

  // count 超时降级（total_partial）时自动轮询：后台补算写入缓存后即可拿到精确 total，
  // 无需用户手动重试；最多 5 次，筛选变化后重置
  const partialRetryRef = useRef(0)
  useEffect(() => {
    partialRetryRef.current = 0
  }, [effParams])
  useEffect(() => {
    if (!data?.total_partial || loading || loadError) return
    if (partialRetryRef.current >= 5) return
    const t = setTimeout(() => {
      partialRetryRef.current += 1
      load()
    }, 4000)
    return () => clearTimeout(t)
  }, [data, loading, loadError, load])

  function applyPreset(preset: PresetView) {
    if (preset.deadline) {
      setDeadlineView((v) => !v)
      return
    }
    setDeadlineView(false)
    setParams((p) => ({
      ...p,
      category: preset.category ?? [],
      year: preset.year ?? [],
      page: 1,
    }))
  }

  function isPresetActive(preset: PresetView): boolean {
    if (preset.deadline) return deadlineView
    const cat = params.category ?? []
    const yr = params.year ?? []
    if (preset.category)
      return cat.length === 1 && cat[0] === preset.category[0] && yr.length === 0
    if (preset.year) return yr.length === 1 && yr[0] === preset.year[0] && cat.length === 0
    return cat.length === 0 && yr.length === 0 && !deadlineView
  }

  const updateParam = useCallback(
    <K extends keyof SearchParams>(key: K, value: SearchParams[K]) => {
      setParams((p) => {
        const next = { ...p, [key]: value }
        if (key !== 'page' && key !== 'page_size') next.page = 1
        return next as SearchParams
      })
    },
    [],
  )

  /** 画像匹配：专业写入统一筛选参数，学历/地点/年份直接复用面板已选值 */
  function applyQuickMatch() {
    const major = majorInput.trim()
    const edu = params.edu_level || []
    const majorType: SearchParams['major_type'] =
      major && edu.length === 1 && edu[0] === '本科'
        ? 'undergrad'
        : major && edu.some((e) => e.startsWith('硕士') || e.startsWith('博士')) && !edu.includes('本科')
        ? 'grad'
        : 'any'
    saveProfile({ ...getProfile(), eduLevel: edu, major, majors: major ? [major] : [], location: params.location || [] })
    setParams((p) => ({
      ...p,
      page: 1,
      major: major || undefined,
      major_type: majorType,
      keyword: '',
      province: undefined,
      work_location: undefined,
    }))
  }

  const activeFilters: RemovableFilter[] = useMemo(() => {
    const out: RemovableFilter[] = []
    if (params.keyword)
    out.push({ label: tt`关键词：${params.keyword}`, onRemove: () => updateParam('keyword', '') })
  if (params.major)
    out.push({ label: tt`专业：${params.major}`, onRemove: () => updateParam('major', undefined) })
  for (const l of params.location ?? [])
    out.push({
      label: tt`地区：${l}`,
      onRemove: () => updateParam('location', (params.location ?? []).filter((x) => x !== l)),
    })
  for (const p of params.province ?? [])
    out.push({
      label: tt`省份：${p}`,
      onRemove: () => updateParam('province', (params.province ?? []).filter((x) => x !== p)),
    })
  for (const w of params.work_location ?? [])
    out.push({
      label: tt`地点：${w}`,
      onRemove: () => updateParam('work_location', (params.work_location ?? []).filter((x) => x !== w)),
    })
  for (const c of params.category ?? [])
    out.push({
      label: tt`类型：${c}`,
      onRemove: () => updateParam('category', (params.category ?? []).filter((x) => x !== c)),
    })
  for (const e of params.edu_level ?? [])
    out.push({
      label: tt`学历：${e}`,
      onRemove: () => updateParam('edu_level', (params.edu_level ?? []).filter((x) => x !== e)),
    })
  for (const y of params.year ?? [])
    out.push({
      label: tt`年份：${y}`,
      onRemove: () => updateParam('year', (params.year ?? []).filter((x) => x !== y)),
    })
    if (params.hide_expired)
      out.push({ label: t("隐藏已截止"), onRemove: () => updateParam('hide_expired', undefined) })
    if (params.created_after)
      out.push({ label: t("仅看上次访问后新增"), onRemove: () => updateParam('created_after', undefined) })
    if (hideSeen) out.push({ label: t("隐藏已看过"), onRemove: () => setHideSeen(false) })
    return out
  }, [params, updateParam, hideSeen])

  const visibleItems = useMemo(
    () =>
      hideSeen
        ? (data?.items ?? []).filter((p) => !seenSet.has(`positions:${p.id}`))
        : data?.items ?? [],
    [data, hideSeen, seenSet],
  )
  const hiddenSeenCount = (data?.items.length ?? 0) - visibleItems.length

  const emptyAction = useMemo(
    () => (
      <div className="flex flex-col items-center gap-3">
        <ActiveFilterChips filters={activeFilters} />
        <SubscribeFilterHint
          canSave={activeFilters.length > 0}
          onSubscribe={() => subscribeCurrentFilter()}
        />
        <HotSearchPills onPick={(w) => updateParam('keyword', w)} />
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeFilters],
  )
  const onPageChange = useCallback((page: number) => updateParam('page', page), [updateParam])
  const onTagClick = useCallback(
    (tagKey: string) => {
      if (tagKey === 'edu_bk') updateParam('edu_level', ['本科'])
    },
    [updateParam],
  )
  const onPageSizeChange = useCallback(
    (size: number) => updateParam('page_size', size),
    [updateParam],
  )
  const columnFilters = useMemo(
    () =>
      filters
        ? {
            year: {
              label: t("年份"),
              options: filters.years.map(String),
              selected: (params.year ?? []).map(String),
              onChange: (v: string[]) =>
                updateParam('year', v.map(Number).filter((n) => !isNaN(n))),
            },
            job_type: {
              label: t("类型"),
              options: filters.categories,
              selected: params.category ?? [],
              onChange: (v: string[]) => updateParam('category', v),
            },
            edu_level_norm: {
              label: t("学历"),
              options: filters.edu_levels,
              selected: params.edu_level ?? [],
              onChange: (v: string[]) => updateParam('edu_level', v),
            },
            work_location: {
              label: t("省份"),
              options: filters.provinces,
              selected: (params.location ?? []).filter((l) => filters.provinces.includes(l)),
              onChange: (v: string[]) => {
                const nonProvince = (params.location ?? []).filter(
                  (l) => !filters.provinces.includes(l),
                )
                updateParam('location', [...nonProvince, ...v])
              },
            },
          }
        : undefined,
    [filters, params.year, params.category, params.edu_level, params.location, updateParam],
  )

  function clearFilters() {
    setParams({ ...DEFAULT_PARAMS })
    setHideSeen(false)
    setRecommendQuery(null)
    setMajorInput('')
  }

  function applyRecommend() {
    const major = majorInput.trim()
    if (!major) return
    saveProfile({ ...getProfile(), eduLevel: params.edu_level || [], major, majors: [major], location: params.location || [] })
    setRecommendQuery({
      major,
      edu_level: params.edu_level?.length ? params.edu_level : undefined,
      location: params.location?.length ? params.location : undefined,
      category: params.job_type?.length ? params.job_type : undefined,
      year: params.year?.length ? params.year : undefined,
    })
  }

  /** 导出文件名：板块+筛选摘要+日期 */
  function exportFname(): string {
    const parts = [
      t("体制内"),
      ...(params.province ?? []),
      ...(params.location ?? []),
      ...(params.exam_type_norm ?? []),
      ...(params.category ?? []),
      ...(params.edu_level ?? []),
      params.keyword || undefined,
      params.major || undefined,
      new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    ]
    return parts.filter(Boolean).join('-')
  }

  function handleExport(format: 'csv' | 'xlsx', all = false) {
    if (exportTask) return
    const total = data?.total ?? 0
    if (!all && total <= SYNC_EXPORT_MAX) {
      window.open(buildExportUrl(effParams, format, exportFname()), '_blank')
      return
    }
    void startAsyncExport(format, all ? ASYNC_EXPORT_MAX : Math.min(total || ASYNC_EXPORT_MAX, ASYNC_EXPORT_MAX))
  }

  async function startAsyncExport(format: 'csv' | 'xlsx', maxRows: number) {
    setExportError('')
    setExportTask('starting')
    try {
      const { task_id } = await createExport(effParams, format, maxRows, exportFname())
      setExportTask(task_id)
      pollExport(task_id)
    } catch {
      setExportTask(null)
      showExportError(t("导出任务创建失败，请稍后重试（频率限制：每分钟 3 次）"))
    }
  }

  function pollExport(taskId: string) {
    if (exportTimerRef.current) clearInterval(exportTimerRef.current)
    exportTimerRef.current = setInterval(async () => {
      try {
        const st = await fetchExportStatus(taskId)
        if (st.status === 'SUCCESS') {
          stopExportPolling()
          setExportTask(null)
          window.location.assign(exportDownloadUrl(taskId))
        } else if (st.status === 'FAILURE' || st.status === 'REVOKED') {
          stopExportPolling()
          setExportTask(null)
          showExportError(tt`导出失败：${st.error || t("服务端处理出错，请重试")}`)
        }
      } catch {
        stopExportPolling()
        setExportTask(null)
        showExportError(t("导出状态查询失败，请重试"))
      }
    }, 3000)
  }

  function stopExportPolling() {
    if (exportTimerRef.current) {
      clearInterval(exportTimerRef.current)
      exportTimerRef.current = null
    }
  }

  function showExportError(msg: string) {
    setExportError(msg)
    setTimeout(() => setExportError(''), 6000)
  }

  const defaultFilterName =
    [
      (() => {
        const locs = params.location?.length
          ? params.location
          : params.province?.length
            ? params.province
            : params.work_location ?? []
        if (locs.length === 0) return null
        return locs.length <= 3 ? locs.join('+') : tt`${locs.slice(0, 3).join('+')}等${locs.length}地`
      })(),
      params.job_type?.[0],
      params.exam_type_norm?.[0],
      params.category?.[0],
      params.edu_level?.[0],
      params.year?.[0],
      deadlineView ? t("即将截止") : null,
      (params.keyword || '').trim() || null,
    ]
      .filter(Boolean)
      .join('·') || t("岗位筛选")

  function subscribeCurrentFilter() {
    const { list } = saveFilter(defaultFilterName, params)
    setSaved(list)
  }

  function handleSaveFilter() {
    const name = saveName.trim() || defaultFilterName
    if (!name) return
    const { list, dropped } = saveFilter(name, params)
    setSaved(list)
    setSaveName('')
    setSaveOpen(false)
    const baseHint = dropped
      ? tt`已达 10 组上限，删除了最旧的「${dropped}」`
      : t("已保存并订阅，上新时 chip 显示「+N 新」")
    setSaveHint(baseHint)
    if (saveNotify && isNewsNotificationSupported()) {
      void enableNotifyForSavedFilter().then((r) => {
        if (r === 'fallback')
          setSaveHint(t("已保存并订阅。浏览器通知未开启，上新将以站内红点提示，可在地址栏站点设置允许通知后到「收藏 → 提醒」开启"))
      })
    }
    setTimeout(() => setSaveHint(null), 8000)
  }

  function applySavedFilter(f: SavedFilter) {
    markSavedFilterSeen('positions', f.name)
    setParams({ ...DEFAULT_PARAMS, ...f.params, page: 1 })
  }

  const positionSuggestWords = useMemo(
    () => [
      ...new Set([
        ...(filters
          ? [
              ...filters.hot_locations,
              ...filters.provinces,
              ...filters.categories,
              ...filters.edu_levels,
            ]
          : []),
        ...HOT_SEARCH.map((h) => h.value),
        ...POSITION_INDUSTRY_WORDS,
      ]),
    ],
    [filters],
  )

  const pinyinSuggestions = useMemo(() => {
    const kw = (params.keyword || '').trim()
    if (!/^[a-zA-Z]{2,}$/.test(kw) || !filters) return []
    const pool = [
      ...new Set([
        ...filters.hot_locations,
        ...filters.provinces,
        ...filters.categories,
        ...filters.edu_levels,
        ...HOT_SEARCH.map((h) => h.value),
      ]),
    ]
    return pool.filter((t) => pinyinMatch(t, kw)).slice(0, 8)
  }, [params.keyword, filters])

  function handleHotSearch(item: (typeof HOT_SEARCH)[number]) {
    if (item.type === 'location') {
      const current = params.location || []
      if (!current.includes(item.value)) {
        updateParam('location', [...current, item.value])
      }
    } else if (item.type === 'major') {
      updateParam('major', item.value)
    } else {
      updateParam('keyword', item.value)
    }
  }

  const keyFilterRow = (className?: string, hideProvince = false) => (
    <div className={cn('grid grid-cols-2 gap-2', hideProvince ? 'sm:grid-cols-3' : 'sm:grid-cols-4', className)}>
      {filters ? (
        <>
          <MultiSelect
            label=""
            triggerLabel={t("年份")}
            options={filters.years.map(String)}
            selected={(params.year || []).map(String)}
            onChange={(v) => updateParam('year', v.map(Number).filter((n) => !isNaN(n)))}
          />
          <MultiSelect
            label=""
            triggerLabel={t("岗位类型")}
            options={filters.job_types}
            selected={params.job_type || []}
            onChange={(v) => updateParam('job_type', v)}
          />
          {!hideProvince && (
            <MultiSelect
              label=""
              triggerLabel={t("省份")}
              options={filters.provinces}
              selected={(params.location || []).filter((v) => filters.provinces.includes(v))}
              onChange={(v) => {
                const nonProvince = (params.location || []).filter((x) => !filters.provinces.includes(x))
                updateParam('location', [...new Set([...v, ...nonProvince])])
              }}
            />
          )}
          <MultiSelect
            label=""
            triggerLabel={t("学历")}
            options={filters.edu_levels}
            selected={params.edu_level || []}
            onChange={(v) => updateParam('edu_level', v)}
          />
        </>
      ) : (
        <>
          {Array.from({ length: hideProvince ? 3 : 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </>
      )}
    </div>
  )

  const advancedFilterPanel = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {filters ? (
        <>
          <MultiSelect
            label={t("考试/招聘类型")}
            options={filters.exam_type_norms || []}
            selected={params.exam_type_norm || []}
            onChange={(v) => updateParam('exam_type_norm', v)}
          />
          <div className="sm:col-span-2 lg:col-span-3 xl:col-span-4">
            <LocationFilter
              filters={filters}
              value={params.location || []}
              onChange={(v) => updateParam('location', v)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("排序")}</label>
            <Select value={params.sort || 'year_desc'} onValueChange={(v) => updateParam('sort', v || undefined)}>
              <SelectTrigger className="h-9" aria-label={t("排序方式")}>
                <SelectValue placeholder={t("排序方式")}>
                  {{ year_desc: t("最新优先（默认）"), year_asc: t("年份从旧到新"), id_desc: t("最新收录优先") }[params.sort || 'year_desc']}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="year_desc">{t("最新优先（默认）")}</SelectItem>
                <SelectItem value="year_asc">{t("年份从旧到新")}</SelectItem>
                <SelectItem value="id_desc">{t("最新收录优先")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      ) : (
        <>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </>
      )}
      <div className="flex items-end">
        <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
          <RotateCcw className="mr-1 h-4 w-4" />
          {t("清空筛选")}{' '}</Button>
      </div>
    </div>
  )

  const activeChips = []
  for (const v of params.exam_type_norm || []) activeChips.push({ label: tt`考试类型：${v}`, onRemove: () => updateParam('exam_type_norm', (params.exam_type_norm || []).filter((x) => x !== v)) })
  for (const v of params.province || []) activeChips.push({ label: tt`省份：${v}`, onRemove: () => updateParam('province', (params.province || []).filter((x) => x !== v)) })
  if (params.keyword) activeChips.push({ label: tt`关键词：${params.keyword}`, onRemove: () => updateParam('keyword', '') })
  if (params.major) activeChips.push({ label: tt`专业：${params.major}`, onRemove: () => updateParam('major', '') })
  for (const y of params.year || []) activeChips.push({ label: tt`年份：${y}`, onRemove: () => updateParam('year', (params.year || []).filter((v) => v !== y)) })
  for (const v of params.edu_level || []) activeChips.push({ label: tt`学历层级：${v}`, onRemove: () => updateParam('edu_level', (params.edu_level || []).filter((x) => x !== v)) })
  for (const v of params.location || []) activeChips.push({ label: tt`地点：${v}`, onRemove: () => updateParam('location', (params.location || []).filter((x) => x !== v)) })
  for (const v of params.category || []) activeChips.push({ label: tt`类型：${v}`, onRemove: () => updateParam('category', (params.category || []).filter((x) => x !== v)) })
  for (const v of params.job_type || []) activeChips.push({ label: tt`岗位类型：${v}`, onRemove: () => updateParam('job_type', (params.job_type || []).filter((x) => x !== v)) })
  for (const v of params.exam_type || []) activeChips.push({ label: tt`考试类型：${v}`, onRemove: () => updateParam('exam_type', (params.exam_type || []).filter((x) => x !== v)) })
  for (const v of params.work_location || []) activeChips.push({ label: tt`精确地点：${v}`, onRemove: () => updateParam('work_location', (params.work_location || []).filter((x) => x !== v)) })

  return (
    <div className={showStats ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start xl:gap-5' : undefined}>
    <div className="flex min-w-0 flex-col gap-5 max-sm:gap-3">
      <NewSinceBanner board="positions" onApply={(since) => updateParam('created_after', since)} />
      {onOpenUpdates && (
        // 矮屏手机（如 375×667）隐藏价值主张条，保证第 2 张岗位卡
        // 在底部导航上方可见 ≥40px；375×812 等常规高度不受影响
        <div className="max-sm:[@media(max-height:700px)]:hidden">
        <ValuePropBanner
          onMatch={() => {
            setToolsOpen(true)
            setTimeout(() => {
              quickMatchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              quickMatchRef.current?.focus({ preventScroll: true })
            }, 60)
          }}
          onOpenUpdates={onOpenUpdates}
        />
        </div>
      )}
      <Card className="max-sm:py-0">
        <CardContent className="space-y-4 p-4 max-sm:space-y-2 max-sm:p-3">
          <div className="flex flex-col gap-3 max-sm:gap-2 lg:flex-row lg:items-start">
            <SearchSuggestInput
              value={params.keyword || ''}
              onValueChange={(v) => updateParam('keyword', v)}
              onSelect={(text) => applySuggestion(text)}
              words={positionSuggestWords}
              suggestBoard="positions"
              extraItems={pinyinSuggestions.map((s) => ({ text: s }))}
              placeholder={t("搜索岗位、单位、专业、地点…")}
            />
            <div className="flex items-center gap-2">
              <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
                <SheetTrigger
                  render={
                    <Button variant="outline" size="sm" className="relative h-10 shrink-0 gap-1.5 sm:h-9 lg:hidden" aria-label={t("筛选")}>
                      <Filter className="h-4 w-4" />
                      {t("筛选")}{' '}{positionsNewSum > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" aria-label={t("常用筛选有上新")} />
                      )}
                    </Button>
                  }
                />
                <SheetContent side="bottom" className="max-h-[85dvh] gap-2 overflow-y-auto rounded-t-2xl px-4 pb-8 pt-4">
                  <SheetHeader className="p-0">
                    <SheetTitle>{t("高级筛选")}</SheetTitle>
                  </SheetHeader>
                  <div className="mt-1 space-y-4 pb-14">
                    {keyFilterRow(undefined, true)}
                    <p className="text-xs text-muted-foreground">{t("省份/城市/区县在下方「工作地点」中级联选择")}</p>
                    {advancedFilterPanel}
                  </div>
                  <div className="sticky bottom-0 mt-4 flex gap-2 bg-popover pt-2">
                    <Button className="flex-1" onClick={() => setFilterOpen(false)}>
                      {t("查看结果")}{data ? tt`（${data.total_partial ? t("至少 ") : ''}${formatTotal(data.total, data.total_capped)} 条）` : ''}
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
              <Button
                variant={advancedOpen ? 'secondary' : 'outline'}
                size="sm"
                className="relative hidden h-9 shrink-0 gap-1.5 lg:inline-flex"
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {t("高级筛选")}{' '}{positionsNewSum > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" aria-label={t("常用筛选有上新")} />
                )}
                {advancedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className={cn('h-10 w-10 sm:h-9 sm:w-9', view === 'card' && 'border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
                aria-label={t("卡片视图")}
                title={t("卡片视图")}
                aria-pressed={view === 'card'}
                onClick={() => setView('card')}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className={cn('h-10 w-10 sm:h-9 sm:w-9', view === 'table' && 'border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
                aria-label={t("表格视图")}
                title={t("表格视图")}
                aria-pressed={view === 'table'}
                onClick={() => setView('table')}
              >
                <Table2 className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className={cn('h-10 w-10 sm:h-9 sm:w-9', view === 'list' && 'border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
                aria-label={t("无限滚动列表")}
                title={t("无限滚动列表（大数据量浏览）")}
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                <Rows3 className="h-4 w-4" />
              </Button>
              <Button
                variant={toolsOpen ? 'secondary' : 'outline'}
                size="icon"
                className="h-10 w-10 sm:hidden"
                aria-label={t("更多搜索工具")}
                title={t("更多搜索工具")}
                aria-expanded={toolsOpen}
                onClick={() => setToolsOpen((v) => !v)}
              >
                <Sparkles className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {synAdded.length > 0 && <SynonymHint added={synAdded} onClose={() => setSynOff(true)} />}

          {keyFilterRow('max-sm:hidden')}

          <div className={cn('space-y-4', !toolsOpen && 'max-sm:hidden')}>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/10 bg-gradient-to-br from-primary/[0.03] to-muted/30 px-3 py-2">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              {t("一键匹配")}{' '}</div>
            <Input
              ref={quickMatchRef}
              value={majorInput}
              onChange={(e) => setMajorInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyQuickMatch()
              }}
              placeholder={t("你的专业，如：计算机科学与技术")}
              className="h-9 w-full min-w-0 flex-1 sm:w-auto sm:min-w-[200px] sm:max-w-[280px]"
              aria-label={t("专业")}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-9" onClick={applyQuickMatch}>
                <Search className="mr-1 h-3.5 w-3.5" />
                {t("匹配筛选")}{' '}</Button>
              <Button size="sm" variant="outline" className="h-9" onClick={applyRecommend} disabled={!majorInput.trim()}>
                <Wand2 className="mr-1 h-3.5 w-3.5" />
                {t("为我推荐")}{' '}</Button>
            </div>
            <span className="text-xs text-muted-foreground">{t("学历/地区/岗位类型直接用上方筛选，不再单独选")}</span>
          </div>

          {advancedOpen && <div className="hidden lg:block">{advancedFilterPanel}</div>}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{t("热门搜索：")}</span>
            {HOT_SEARCH.map((item) => (
              <Badge
                key={item.label}
                variant="outline"
                className="cursor-pointer hover:bg-muted"
                onClick={() => handleHotSearch(item)}
                render={<button type="button" />}
              >
                {item.label}
              </Badge>
            ))}
          </div>

          {recent.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">{t("最近搜索：")}</span>
              {recent.map((kw) => (
                <Badge
                  key={kw}
                  variant="outline"
                  className="cursor-pointer hover:bg-muted"
                  onClick={() => updateParam('keyword', kw)}
                  render={<button type="button" />}
                >
                  {kw}
                </Badge>
              ))}
              <Button
                variant="link"
                size="sm"
                className="h-auto min-h-11 min-w-11 px-2 py-1 text-xs text-muted-foreground sm:min-h-0 sm:min-w-0 sm:p-0"
                onClick={() => setRecent(clearRecentSearches())}
              >
                {t("清除")}{' '}</Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{t("保存的筛选：")}</span>
            {saved.map((f) => (
              <Badge key={f.name} variant="secondary" className="gap-1 font-normal">
                <span className="cursor-pointer" onClick={() => applySavedFilter(f)}>
                  {f.name}
                </span>
                {(savedNews.counts[`positions|${f.name}`] ?? 0) > 0 && (
                  <span className="shrink-0 rounded-sm bg-red-500/15 px-1.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                    +{savedNews.counts[`positions|${f.name}`]} {' '}{t("新")}{' '}</span>
                )}
                <button
                  type="button"
                  aria-label={tt`删除筛选 ${f.name}`}
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    removeSavedFilterBaseline('positions', f.name)
                    setSaved(deleteFilter(f.name))
                  }}
                >
                  <X className="pointer-events-none h-3 w-3" />
                </button>
              </Badge>
            ))}
            {saveOpen ? (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <Input
                  autoFocus
                  onFocus={(e) => {
                    e.currentTarget.setSelectionRange(0, 0)
                    e.currentTarget.scrollLeft = 0
                  }}
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveFilter()}
                  placeholder={defaultFilterName}
                  className="h-7 w-32 text-xs"
                />
                {isNewsNotificationSupported() && (
                  <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={saveNotify}
                      onChange={(e) => setSaveNotify(e.target.checked)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    {t("有新岗位通知我")}
                  </label>
                )}
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSaveFilter} aria-label={t("确认保存")}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => {
                    setSaveOpen(false)
                    setSaveName('')
                  }}
                  aria-label={t("取消保存")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </span>
            ) : (
              <span title={activeFilters.length === 0 && !deadlineView ? t("先设置筛选条件后可保存") : undefined}>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto min-h-11 p-0 text-xs disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0"
                  disabled={activeFilters.length === 0 && !deadlineView}
                  onClick={() => {
                    setSaveName(defaultFilterName)
                    setSaveNotify(true)
                    setSaveOpen(true)
                  }}
                >
                  <BookmarkPlus className="mr-0.5 h-3.5 w-3.5" />
                  {t("保存当前筛选")}{' '}</Button>
              </span>
            )}
            {saveHint && <span className="text-muted-foreground">{saveHint}</span>}
            {exportTask ? (
              <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("正在导出…完成后自动下载")}{' '}</span>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="link"
                      size="sm"
                      className="hidden h-auto p-0 text-xs sm:inline-flex"
                    >
                      <Download className="mr-0.5 h-3.5 w-3.5" />
                      {t("导出")}{' '}</Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleExport('csv')}>
                    {t("导出 CSV")}{data && data.total > SYNC_EXPORT_MAX ? t("（异步）") : ''}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('xlsx')}>
                    {t("导出 Excel")}{data && data.total > SYNC_EXPORT_MAX ? t("（异步）") : ''}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('csv', true)}>
                    {t("全部导出 CSV（最多 5 万行）")}{' '}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('xlsx', true)}>
                    {t("全部导出 Excel（最多 5 万行）")}{' '}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="link"
              size="sm"
              className="relative h-auto min-h-11 px-1 py-0 text-xs sm:min-h-0"
              onClick={copyShareLink}
            >
              {copied ? (
                <>
                  <Check className="mr-0.5 h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                  {t("已复制")}{' '}<span className="absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 text-[11px] text-background shadow">
                    {t("链接已复制，可直接粘贴分享")}{' '}</span>
                </>
              ) : (
                <>
                  <Link2 className="mr-0.5 h-3.5 w-3.5" />
                  {t("复制筛选链接")}{' '}</>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="link" size="sm" className="h-11 p-0 text-xs sm:hidden">
                    <Download className="mr-0.5 h-3.5 w-3.5" />
                    {t("导出")}{' '}</Button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem disabled={!!exportTask} onClick={() => handleExport('csv')}>
                  <Download className="h-4 w-4" />
                  <span className="flex flex-col whitespace-nowrap">
                    {t("导出 CSV")}{' '}{data && data.total > SYNC_EXPORT_MAX && (
                      <span className="text-[11px] text-muted-foreground">{t("数据量大，转异步任务")}</span>
                    )}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!!exportTask} onClick={() => handleExport('xlsx')}>
                  <Download className="h-4 w-4" />
                  <span className="flex flex-col whitespace-nowrap">
                    {t("导出 Excel")}{' '}{data && data.total > SYNC_EXPORT_MAX && (
                      <span className="text-[11px] text-muted-foreground">{t("数据量大，转异步任务")}</span>
                    )}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!!exportTask} onClick={() => handleExport('csv', true)}>
                  <Download className="h-4 w-4" />
                  <span className="flex flex-col whitespace-nowrap">
                    {t("全部导出 CSV")}{' '}<span className="text-[11px] text-muted-foreground">{t("最多 5 万行")}</span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!!exportTask} onClick={() => handleExport('xlsx', true)}>
                  <Download className="h-4 w-4" />
                  <span className="flex flex-col whitespace-nowrap">
                    {t("全部导出 Excel")}{' '}<span className="text-[11px] text-muted-foreground">{t("最多 5 万行")}</span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          </div>

          {activeChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("已选筛选：")}</span>
              {activeChips.map((chip, idx) => (
                <Badge key={idx} variant="secondary" className="gap-1 text-xs font-normal">
                  {chip.label}
                  <button
                    type="button"
                    aria-label={tt`移除 ${chip.label}`}
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                    onClick={chip.onRemove}
                  >
                    <X className="pointer-events-none h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Button variant="link" size="sm" className="h-auto min-h-11 p-0 text-xs sm:min-h-0" onClick={clearFilters}>
                {t("清除全部")}{' '}</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {recommendQuery && (
        <Suspense fallback={null}>
          <RecommendPanel query={recommendQuery} onClose={() => setRecommendQuery(null)} />
        </Suspense>
      )}

      {/* 移动端（<sm）截止卡/速览/推荐排到岗位列表之后，保首屏岗位可见 */}
      {showStats && !deadlineView && !newSinceOnScreen && (
        <div className="max-sm:order-1">
          <DeadlinesCard />
        </div>
      )}

      <div className="relative">
      <div className="scrollbar-none -mx-1 flex items-center gap-2 overflow-x-auto px-1 py-0.5 max-sm:py-0 sm:flex-wrap">
        {PRESET_VIEWS.map((preset) => {
          const active = isPresetActive(preset)
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyPreset(preset)}
              className={cn(
                'min-h-9 shrink-0 cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              {preset.label}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => updateParam('hide_expired', params.hide_expired ? undefined : true)}
          className={cn(
            'min-h-9 shrink-0 cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0',
            params.hide_expired
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          )}
        >
          {t("隐藏已截止")}{' '}</button>
        <button
          type="button"
          onClick={() => setHideSeen((v) => !v)}
          className={cn(
            'min-h-9 shrink-0 cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0',
            hideSeen
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          )}
        >
          {t("隐藏已看过")}{' '}</button>
        {crossPresets && crossPresets.length > 0 && onCrossPreset && (
          <>
            <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
            <span className="shrink-0 text-xs text-muted-foreground">{t("去其他板块")}</span>
            {crossPresets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onCrossPreset(p.key)}
                className="inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-dashed border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground sm:min-h-0"
              >
                {p.label}
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </button>
            ))}
          </>
        )}
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 -right-1 w-8 bg-gradient-to-l from-background to-transparent sm:hidden"
        aria-hidden
      />
      </div>

      {showStats && onCrossPreset && (
        <div className="max-sm:order-1">
          <TodayGlance
            onUpdates={onOpenUpdates}
            onCampus={() => onCrossPreset('recent7')}
            onCampusAll={() => onCrossPreset('all')}
            onBianzhi={() => onCrossPreset('bz:all')}
            onDeadline={() => setDeadlineView(true)}
          />
        </div>
      )}

      {showStats && (
        <div className="max-sm:order-1">
          <RecommendSection />
        </div>
      )}

      {crossTotal > 0 && onCrossOpen && (
        <button
          type="button"
          onClick={() => onCrossOpen((params.keyword || '').trim())}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-left text-sm text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200 dark:hover:bg-sky-900"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span>
            {t("换个板块看看：")}{crossLabel || t("另一板块")}{t("中另有")}{' '}
            <span className="font-semibold">{crossTotal.toLocaleString()}</span> {' '}{t("条与「")}{' '}{(params.keyword || '').trim()}{t("」相关 →")}{' '}</span>
        </button>
      )}

      {deadlineView && <DeadlinesCard days={14} limit={100} defaultExpanded />}

      {!deadlineView && (
      <>
      {loadError && !loading && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <span>{t("加载失败，服务器可能正忙，请重试")}</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => load()}>
            {t("重试")}{' '}</Button>
        </div>
      )}
      {!loading &&
        !loadError &&
        data &&
        data.total === 0 &&
        ((params.location?.length ?? 0) > 0 || (params.province?.length ?? 0) > 0) && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <span>
              {t("没有结果，可能是地域筛选（")}{' '}{[...(params.province ?? []), ...(params.location ?? [])].join('、')}
              {t("）与其他条件冲突")}{' '}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setParams((p) => ({ ...p, location: [], province: undefined, page: 1 }))
              }}
            >
              {t("清除地域筛选")}{' '}</Button>
            {onCrossPreset &&
              (() => {
                const provs = new Set(filters?.provinces ?? [])
                const prov = [...(params.province ?? []), ...(params.location ?? [])].find((v) =>
                  provs.has(v),
                )
                const jt = [...(params.job_type ?? []), ...(params.exam_type_norm ?? [])].join('')
                const preset = /教师|教育/.test(jt) ? 'edu' : /医疗|医院|卫生/.test(jt) ? 'med' : 'all'
                if (!prov) return null
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onCrossPreset(`bzp:${preset}:${prov}`)}
                  >
                    {t("去编制板找")}{prov}{preset === 'edu' ? t("教师") : preset === 'med' ? t("医疗") : ''}{t("岗位")}{' '}</Button>
                )
              })()}
          </div>
        )}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="shrink-0 whitespace-nowrap text-xl font-bold tracking-tight max-sm:text-lg">{title}</h1>
          {data && (
            <>
            <Badge
              variant="secondary"
              className="text-sm font-medium"
              title={
                data.total_partial
                  ? t("计数超时，仅统计岗位名/单位名命中，精确值正在后台补算")
                  : data.total_capped
                    ? t("结果超过 10,000 条，计数已达统计上限")
                    : undefined
              }
            >
              {data.total_partial ? t("至少 ") : t("共 ")}
              {formatTotal(data.total, data.total_capped)} {' '}{t("条")}{' '}{!data.total_partial && data.total_capped && (
                <span className="hidden sm:inline">{t("（已达统计上限）")}</span>
              )}
            </Badge>
            {data.total_partial && !loading && (
              <button
                type="button"
                onClick={() => load()}
                title={t("结果不完整，点击重试")}
                className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground sm:min-h-0"
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                {t("正在统计精确数量…")}{' '}</button>
            )}
            </>
          )}
          <FreshnessNote board="positions" />
        </div>
      </div>

      <FilterSummaryBar filters={activeFilters} onClearAll={clearFilters} />

      {hideSeen && hiddenSeenCount > 0 && view !== 'list' && (
        <div className="text-xs text-muted-foreground">{t("本页已隐藏")}{' '}{hiddenSeenCount} {' '}{t("条已看过的岗位")}</div>
      )}

      {data && !loading && data.total === 0 && (params.keyword || '').trim() && onOpenBoardKw && (
        <CrossBoardZeroHint from="positions" keyword={params.keyword || ''} onOpen={onOpenBoardKw} />
      )}

      {loading && slowLoading && (
        <div
          role="status"
          className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200"
        >
          {t("结果较多，正在统计中，请稍候…如长时间无响应可减少筛选条件后重试")}{' '}</div>
      )}
      {data?.timed_out && (
        <div
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
        >
          {data.items.length > 0
            ? t("搜索部分超时，当前仅显示岗位名/单位名命中的结果，稍后重试可获得完整结果")
            : t("搜索超时，请换关键词（更具体的词或加筛选条件）")}
        </div>
      )}

      <div className="relative">
      {loading && view !== 'list' && (data?.items.length ?? 0) > 0 && (
        <div
          className={cn(
            'pointer-events-none sticky inset-x-0 z-10 -mb-7 flex h-7 justify-center',
            view === 'table' ? 'top-24 xl:top-14' : 'top-2',
          )}
        >
          <span
            role="status"
            className="flex items-center gap-1.5 rounded-md border bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("正在更新结果…")}{' '}</span>
        </div>
      )}
      <PullToRefresh onRefresh={load} refreshing={loading} disabled={view === 'list'}>
      <Suspense
        fallback={
          <div className="space-y-3 rounded-xl border bg-card p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        }
      >
      {view === 'table' && (
        <PositionTable
          emptyAction={emptyAction}
          highlight={params.keyword}
          data={visibleItems}
          total={data?.total || 0}
          totalCapped={data?.total_capped}
          totalPartial={data?.total_partial}
          page={data?.page || 1}
          pageSize={data?.page_size || 20}
          loading={loading}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          columnFilters={columnFilters}
          onTagClick={onTagClick}
        />
      )}
      {view === 'card' && (
        <PositionCardGrid
          data={visibleItems}
          loading={loading}
          emptyAction={emptyAction}
          highlight={params.keyword}
          onTagClick={onTagClick}
        />
      )}
      {view === 'list' && <VirtualPositionList fetcher={fetcher} params={effParams} />}
      </Suspense>
      </PullToRefresh>
      </div>

      {view === 'card' && data && data.total > 0 && (
        <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
          <div className="text-sm text-muted-foreground">
            {data.total_partial ? t("至少 ") : t("共 ")}
            <span className="font-medium text-foreground">{formatTotal(data.total, data.total_capped)}</span> {' '}{t("条 · 第")}{' '}
            <span className="font-medium text-foreground">
              {data.page}/{Math.max(1, Math.ceil(data.total / data.page_size))}
            </span>{' '}
            {t("页")}{' '}</div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-11 px-4 sm:h-8 sm:px-3"
              onClick={() => updateParam('page', Math.max(1, data.page - 1))}
              disabled={data.page <= 1}
            >
              {t("上一页")}{' '}</Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 px-4 sm:h-8 sm:px-3"
              onClick={() => updateParam('page', data.page + 1)}
              disabled={data.page >= Math.ceil(data.total / data.page_size)}
            >
              {t("下一页")}{' '}</Button>
          </div>
        </div>
      )}
      </>
      )}

      {exportTask && (
        <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-popover px-4 py-2 text-sm shadow-lg">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {t("正在导出…完成后自动下载")}{' '}</div>
      )}
      {exportError && (
        <div className="fixed bottom-20 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 shadow-lg dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {exportError}
        </div>
      )}
    </div>
    {showStats && (
      <aside className="mt-5 xl:sticky xl:top-16 xl:mt-0 xl:max-h-[calc(100dvh-5rem)] xl:overflow-y-auto">
        <StatsDashboard
          variant="sidebar"
          selectedYear={params.year?.[0]}
          selectedExamType={params.exam_type_norm?.[0]}
          selectedProvinces={params.location}
          onSelectYear={(y) => updateParam('year', params.year?.[0] === y ? [] : [y])}
          onSelectExamType={(t) => updateParam('exam_type_norm', params.exam_type_norm?.[0] === t ? [] : [t])}
          onSelectProvince={(p) =>
            updateParam(
              'location',
              params.location?.includes(p)
                ? params.location.filter((v) => v !== p)
                : [...new Set([...(params.location || []), p])],
            )
          }
        />
      </aside>
    )}
    </div>
  )
}
