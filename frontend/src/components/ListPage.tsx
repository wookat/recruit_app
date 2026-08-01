import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  fetchFilters,
  fetchSuggestions,
  formatTotal,
  type PositionList,
  type FilterOptions,
  type SearchParams,
  type Suggestion,
} from '@/api'
import { StatsDashboard } from './StatsDashboard'
import { FreshnessNote } from './FreshnessNote'
import { DeadlinesCard } from './DeadlinesCard'
import { TodayGlance } from './TodayGlance'
import { buildShareUrl, paramsFromQueryString, paramsToQueryString, POSITION_URL_KEYS } from '@/lib/urlFilters'
import { MultiSelect } from './MultiSelect'
import { PositionTable } from './PositionTable'
import { PositionCardGrid } from './PositionCardGrid'
import { VirtualPositionList } from './VirtualPositionList'
import { QuickMatch, type QuickMatchValues } from './QuickMatch'
import { RecommendPanel, type RecommendQuery } from './RecommendPanel'
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
import { markSavedFilterSeen, removeSavedFilterBaseline, useSavedNews } from '@/lib/savedNews'
import {
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
  MoreHorizontal,
  SlidersHorizontal,
  Loader2,
  ChevronDown,
  ChevronUp,
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
import { cn } from '@/lib/utils'
import { ActiveFilterChips, FilterSummaryBar, type RemovableFilter } from './ActiveFilterChips'
import { SearchSuggestInput } from './SearchSuggestInput'
import { RecommendSection } from './RecommendSection'
import { CrossBoardZeroHint } from './CrossBoardZeroHint'

interface ListPageProps {
  title: string
  fetcher: (params: SearchParams, signal?: AbortSignal) => Promise<PositionList>
  showStats?: boolean
  syncUrl?: boolean
  initialPresetKey?: string
  initialKeyword?: string
  crossPresets?: { key: string; label: string }[]
  onCrossPreset?: (key: string) => void
  crossLabel?: string
  crossFetchTotal?: (keyword: string) => Promise<number>
  onCrossOpen?: (keyword: string) => void
  onOpenBoardKw?: (board: 'positions' | 'campus' | 'bianzhi', keyword: string) => void
}

const HOT_SEARCH = [
  { label: '北京', type: 'location' as const, value: '北京' },
  { label: '上海', type: 'location' as const, value: '上海' },
  { label: '广州', type: 'location' as const, value: '广州' },
  { label: '深圳', type: 'location' as const, value: '深圳' },
  { label: '杭州', type: 'location' as const, value: '杭州' },
  { label: '计算机', type: 'major' as const, value: '计算机' },
  { label: '法学', type: 'major' as const, value: '法学' },
  { label: '会计', type: 'major' as const, value: '会计' },
  { label: '国考', type: 'keyword' as const, value: '国考' },
  { label: '央企校招', type: 'keyword' as const, value: '央企校招' },
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
  { key: 'all', label: '全部' },
  { key: 'gwy', label: '公务员', category: ['公务员'] },
  { key: 'sye', label: '事业编', category: ['事业单位/事业编'] },
  { key: 'jdwz', label: '军队文职', category: ['军队文职'] },
  { key: 'gqyq', label: '国企央企', category: ['国企/央企'] },
  { key: 'xds', label: '选调生', category: ['选调生'] },
  { key: 'y2027', label: '2027 最新', year: [2027] },
  { key: 'deadline', label: '即将截止', deadline: true },
]

type ViewMode = 'table' | 'card' | 'list'

function defaultView(): ViewMode {
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches) {
    return 'card'
  }
  return 'table'
}

export function ListPage({
  title,
  fetcher,
  showStats,
  syncUrl,
  initialPresetKey,
  initialKeyword,
  crossPresets,
  onCrossPreset,
  crossLabel,
  crossFetchTotal,
  onCrossOpen,
  onOpenBoardKw,
}: ListPageProps) {
  const [filters, setFilters] = useState<FilterOptions | null>(null)
  const [data, setData] = useState<PositionList | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<ViewMode>(defaultView)
  const [filterOpen, setFilterOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [deadlineView, setDeadlineView] = useState(false)
  const [quickMatchKey, setQuickMatchKey] = useState(0)
  const [params, setParams] = useState<SearchParams>(() => {
    const fromUrl = syncUrl && !new URLSearchParams(window.location.search).get('board')
    const base = fromUrl
      ? { ...DEFAULT_PARAMS, ...paramsFromQueryString(window.location.search) }
      : { ...DEFAULT_PARAMS }
    const preset = initialPresetKey
      ? PRESET_VIEWS.find((p) => p.key === initialPresetKey)
      : undefined
    if (preset?.category) base.category = preset.category
    if (preset?.year) base.year = preset.year
    if (initialKeyword) base.keyword = initialKeyword
    return base
  })
  const [crossTotal, setCrossTotal] = useState(0)

  useEffect(() => {
    const kw = (params.keyword || '').trim()
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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [copied, setCopied] = useState(false)
  const [recommendQuery, setRecommendQuery] = useState<RecommendQuery | null>(null)
  const [exportTask, setExportTask] = useState<string | null>(null)
  const [exportError, setExportError] = useState('')
  const [loadError, setLoadError] = useState(false)
  const suggestDisabledRef = useRef(false)
  const skipSuggestRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const exportTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (exportTimerRef.current) clearInterval(exportTimerRef.current)
    }
  }, [])

  useEffect(() => {
    fetchFilters().then(setFilters).catch(console.error)
  }, [])

  useEffect(() => {
    if (!syncUrl) return
    const cur = new URLSearchParams(window.location.search)
    if (cur.get('board')) return
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

  useEffect(() => {
    const kw = (params.keyword || '').trim()
    if (
      suggestDisabledRef.current ||
      kw.length < 1 ||
      (kw.length < 2 && !/[\u4e00-\u9fff]/.test(kw)) ||
      skipSuggestRef.current === kw
    ) {
      setSuggestions([])
      return
    }
    const t = setTimeout(() => {
      fetchSuggestions(kw)
        .then((s) => setSuggestions(s.filter((x) => x.text !== kw)))
        .catch((e) => {
          if (e?.response?.status === 404) suggestDisabledRef.current = true
          setSuggestions([])
        })
    }, 250)
    return () => clearTimeout(t)
  }, [params.keyword])

  function applySuggestion(text: string) {
    skipSuggestRef.current = text
    setSuggestions([])
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
    setTimeout(() => setCopied(false), 2000)
  }

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetcher(params, controller.signal)
      if (controller.signal.aborted) return
      setData(res)
      const kw = (params.keyword || '').trim()
      if (kw.length >= 2) setRecent(addRecentSearch(kw))
    } catch (e) {
      if (!controller.signal.aborted) {
        console.error(e)
        setLoadError(true)
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [fetcher, params])

  useEffect(() => {
    if (view === 'list') return
    const t = setTimeout(load, 300)
    return () => {
      clearTimeout(t)
      abortRef.current?.abort()
    }
  }, [load, view])

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

  function applyQuickMatch(values: QuickMatchValues) {
    const majorType: SearchParams['major_type'] =
      values.major && values.eduLevel.length === 1 && values.eduLevel[0] === '本科'
        ? 'undergrad'
        : values.major &&
          values.eduLevel.some((e) => e.startsWith('硕士') || e.startsWith('博士')) &&
          !values.eduLevel.includes('本科')
        ? 'grad'
        : 'any'

    setParams((p) => ({
      ...p,
      page: 1,
      edu_level: values.eduLevel,
      major: values.major || undefined,
      major_type: majorType,
      location: values.location,
      category: values.category,
      year: values.year.map(Number).filter((n) => !isNaN(n)),
      keyword: '',
      province: undefined,
      work_location: undefined,
    }))
  }

  const activeFilters: RemovableFilter[] = useMemo(() => {
    const out: RemovableFilter[] = []
    if (params.keyword)
    out.push({ label: `关键词：${params.keyword}`, onRemove: () => updateParam('keyword', '') })
  if (params.major)
    out.push({ label: `专业：${params.major}`, onRemove: () => updateParam('major', undefined) })
  for (const l of params.location ?? [])
    out.push({
      label: `地区：${l}`,
      onRemove: () => updateParam('location', (params.location ?? []).filter((x) => x !== l)),
    })
  for (const p of params.province ?? [])
    out.push({
      label: `省份：${p}`,
      onRemove: () => updateParam('province', (params.province ?? []).filter((x) => x !== p)),
    })
  for (const w of params.work_location ?? [])
    out.push({
      label: `地点：${w}`,
      onRemove: () => updateParam('work_location', (params.work_location ?? []).filter((x) => x !== w)),
    })
  for (const c of params.category ?? [])
    out.push({
      label: `类型：${c}`,
      onRemove: () => updateParam('category', (params.category ?? []).filter((x) => x !== c)),
    })
  for (const e of params.edu_level ?? [])
    out.push({
      label: `学历：${e}`,
      onRemove: () => updateParam('edu_level', (params.edu_level ?? []).filter((x) => x !== e)),
    })
  for (const y of params.year ?? [])
    out.push({
      label: `年份：${y}`,
      onRemove: () => updateParam('year', (params.year ?? []).filter((x) => x !== y)),
    })
    if (params.hide_expired)
      out.push({ label: '隐藏已截止', onRemove: () => updateParam('hide_expired', undefined) })
    return out
  }, [params, updateParam])

  const emptyAction = useMemo(() => <ActiveFilterChips filters={activeFilters} />, [activeFilters])
  const onPageChange = useCallback((page: number) => updateParam('page', page), [updateParam])
  const onPageSizeChange = useCallback(
    (size: number) => updateParam('page_size', size),
    [updateParam],
  )
  const columnFilters = useMemo(
    () =>
      filters
        ? {
            year: {
              label: '年份',
              options: filters.years.map(String),
              selected: (params.year ?? []).map(String),
              onChange: (v: string[]) =>
                updateParam('year', v.map(Number).filter((n) => !isNaN(n))),
            },
            job_type: {
              label: '类型',
              options: filters.categories,
              selected: params.category ?? [],
              onChange: (v: string[]) => updateParam('category', v),
            },
            edu_level_norm: {
              label: '学历',
              options: filters.edu_levels,
              selected: params.edu_level ?? [],
              onChange: (v: string[]) => updateParam('edu_level', v),
            },
            work_location: {
              label: '省份',
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
    setRecommendQuery(null)
    setQuickMatchKey((k) => k + 1)
  }

  function applyRecommend(values: QuickMatchValues) {
    setRecommendQuery({
      major: values.major,
      edu_level: values.eduLevel.length ? values.eduLevel : undefined,
      location: values.location.length ? values.location : undefined,
      category: values.category.length ? values.category : undefined,
      year: values.year.map(Number).filter((n) => !isNaN(n)),
    })
  }

  function handleExport(format: 'csv' | 'xlsx', all = false) {
    if (exportTask) return
    const total = data?.total ?? 0
    if (!all && total <= SYNC_EXPORT_MAX) {
      window.open(buildExportUrl(params, format), '_blank')
      return
    }
    void startAsyncExport(format, all ? ASYNC_EXPORT_MAX : Math.min(total || ASYNC_EXPORT_MAX, ASYNC_EXPORT_MAX))
  }

  async function startAsyncExport(format: 'csv' | 'xlsx', maxRows: number) {
    setExportError('')
    setExportTask('starting')
    try {
      const { task_id } = await createExport(params, format, maxRows)
      setExportTask(task_id)
      pollExport(task_id)
    } catch {
      setExportTask(null)
      showExportError('导出任务创建失败，请稍后重试（频率限制：每分钟 3 次）')
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
          showExportError(`导出失败：${st.error || '服务端处理出错，请重试'}`)
        }
      } catch {
        stopExportPolling()
        setExportTask(null)
        showExportError('导出状态查询失败，请重试')
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
      params.location?.[0] ?? params.province?.[0] ?? params.work_location?.[0],
      params.category?.[0],
      params.edu_level?.[0],
      params.year?.[0],
      deadlineView ? '即将截止' : null,
      (params.keyword || '').trim() || null,
    ]
      .filter(Boolean)
      .join('·') || '岗位筛选'

  function handleSaveFilter() {
    const name = saveName.trim() || defaultFilterName
    if (!name) return
    const { list, dropped } = saveFilter(name, params)
    setSaved(list)
    setSaveName('')
    setSaveOpen(false)
    setSaveHint(dropped ? `已达 10 组上限，删除了最旧的「${dropped}」` : null)
    if (dropped) setTimeout(() => setSaveHint(null), 4000)
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

  const keyFilterRow = (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {filters ? (
        <>
          <MultiSelect
            label=""
            triggerLabel="年份"
            options={filters.years.map(String)}
            selected={(params.year || []).map(String)}
            onChange={(v) => updateParam('year', v.map(Number).filter((n) => !isNaN(n)))}
          />
          <MultiSelect
            label=""
            triggerLabel="岗位类型"
            options={filters.categories}
            selected={params.category || []}
            onChange={(v) => updateParam('category', v)}
          />
          <MultiSelect
            label=""
            triggerLabel="省份"
            options={filters.provinces}
            selected={params.province || []}
            onChange={(v) => updateParam('province', v)}
          />
          <MultiSelect
            label=""
            triggerLabel="学历"
            options={filters.edu_levels}
            selected={params.edu_level || []}
            onChange={(v) => updateParam('edu_level', v)}
          />
        </>
      ) : (
        <>
          {Array.from({ length: 4 }).map((_, i) => (
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
            label="年份"
            options={filters.years.map(String)}
            selected={(params.year || []).map(String)}
            onChange={(v) => updateParam('year', v.map(Number).filter((n) => !isNaN(n)))}
          />
          <MultiSelect
            label="工作类型"
            options={filters.job_types}
            selected={params.job_type || []}
            onChange={(v) => updateParam('job_type', v)}
          />
          <MultiSelect
            label="目标类型"
            options={filters.categories}
            selected={params.category || []}
            onChange={(v) => updateParam('category', v)}
          />
          <MultiSelect
            label="学历层级"
            options={filters.edu_levels}
            selected={params.edu_level || []}
            onChange={(v) => updateParam('edu_level', v)}
          />

          <MultiSelect
            label="考试/招聘类型"
            options={filters.exam_types}
            selected={params.exam_type || []}
            onChange={(v) => updateParam('exam_type', v)}
          />
          <div className="sm:col-span-2 lg:col-span-3 xl:col-span-4">
            <LocationFilter
              filters={filters}
              value={params.location || []}
              onChange={(v) => updateParam('location', v)}
            />
          </div>
          <MultiSelect
            label="工作地点（精确原文）"
            options={filters.work_locations}
            selected={params.work_location || []}
            onChange={(v) => updateParam('work_location', v)}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">排序</label>
            <Select value={params.sort || 'year_desc'} onValueChange={(v) => updateParam('sort', v || undefined)}>
              <SelectTrigger className="h-9" aria-label="排序方式">
                <SelectValue placeholder="排序方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="year_desc">年份从新到旧</SelectItem>
                <SelectItem value="year_asc">年份从旧到新</SelectItem>
                <SelectItem value="id_desc">录入时间倒序</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      ) : (
        <>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </>
      )}
      <div className="flex items-end">
        <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
          <RotateCcw className="mr-1 h-4 w-4" />
          清空筛选
        </Button>
      </div>
    </div>
  )

  const activeChips = []
  for (const v of params.exam_type_norm || []) activeChips.push({ label: `考试类型：${v}`, onRemove: () => updateParam('exam_type_norm', (params.exam_type_norm || []).filter((x) => x !== v)) })
  for (const v of params.province || []) activeChips.push({ label: `省份：${v}`, onRemove: () => updateParam('province', (params.province || []).filter((x) => x !== v)) })
  if (params.keyword) activeChips.push({ label: `关键词：${params.keyword}`, onRemove: () => updateParam('keyword', '') })
  if (params.major) activeChips.push({ label: `专业：${params.major}`, onRemove: () => updateParam('major', '') })
  for (const y of params.year || []) activeChips.push({ label: `年份：${y}`, onRemove: () => updateParam('year', (params.year || []).filter((v) => v !== y)) })
  for (const v of params.edu_level || []) activeChips.push({ label: `学历层级：${v}`, onRemove: () => updateParam('edu_level', (params.edu_level || []).filter((x) => x !== v)) })
  for (const v of params.location || []) activeChips.push({ label: `地点：${v}`, onRemove: () => updateParam('location', (params.location || []).filter((x) => x !== v)) })
  for (const v of params.category || []) activeChips.push({ label: `类型：${v}`, onRemove: () => updateParam('category', (params.category || []).filter((x) => x !== v)) })
  for (const v of params.job_type || []) activeChips.push({ label: `工作类型：${v}`, onRemove: () => updateParam('job_type', (params.job_type || []).filter((x) => x !== v)) })
  for (const v of params.exam_type || []) activeChips.push({ label: `考试类型：${v}`, onRemove: () => updateParam('exam_type', (params.exam_type || []).filter((x) => x !== v)) })
  for (const v of params.work_location || []) activeChips.push({ label: `精确地点：${v}`, onRemove: () => updateParam('work_location', (params.work_location || []).filter((x) => x !== v)) })

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <SearchSuggestInput
              value={params.keyword || ''}
              onValueChange={(v) => updateParam('keyword', v)}
              onSelect={(text) => applySuggestion(text)}
              words={positionSuggestWords}
              extraItems={[
                ...suggestions
                  .filter(
                    (s) =>
                      s.text.length <= 12 &&
                      !/[，。、；！？]/.test(s.text) &&
                      !/从事|等工作|负责|相关工作/.test(s.text),
                  )
                  .map((s) => ({ text: s.text, count: s.count })),
                ...pinyinSuggestions.map((s) => ({ text: s })),
              ]}
              placeholder="搜索岗位、单位、专业、地点…"
            />
            <div className="flex items-center gap-2">
              <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
                <SheetTrigger
                  render={
                    <Button variant="outline" size="sm" className="relative h-11 shrink-0 gap-1.5 sm:h-9 lg:hidden" aria-label="筛选">
                      <Filter className="h-4 w-4" />
                      筛选
                      {positionsNewSum > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" aria-label="常用筛选有上新" />
                      )}
                    </Button>
                  }
                />
                <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-4">
                  <SheetHeader>
                    <SheetTitle>高级筛选</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4 space-y-4">{advancedFilterPanel}</div>
                  <div className="sticky bottom-0 mt-4 flex gap-2 bg-popover pt-2">
                    <Button className="flex-1" onClick={() => setFilterOpen(false)}>
                      查看结果{data ? `（${formatTotal(data.total, data.total_capped)} 条）` : ''}
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
                高级筛选
                {positionsNewSum > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" aria-label="常用筛选有上新" />
                )}
                {advancedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant={view === 'card' ? 'default' : 'outline'}
                size="icon"
                className="h-11 w-11 sm:h-9 sm:w-9"
                aria-label="卡片视图"
                onClick={() => setView('card')}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={view === 'table' ? 'default' : 'outline'}
                size="icon"
                className="h-11 w-11 sm:h-9 sm:w-9"
                aria-label="表格视图"
                onClick={() => setView('table')}
              >
                <Table2 className="h-4 w-4" />
              </Button>
              <Button
                variant={view === 'list' ? 'default' : 'outline'}
                size="icon"
                className="h-11 w-11 sm:h-9 sm:w-9"
                aria-label="无限滚动列表"
                title="无限滚动列表（大数据量浏览）"
                onClick={() => setView('list')}
              >
                <Rows3 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {keyFilterRow}

          {advancedOpen && <div className="hidden lg:block">{advancedFilterPanel}</div>}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">热门搜索：</span>
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
              <span className="text-muted-foreground">最近搜索：</span>
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
                清除
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">保存的筛选：</span>
            {saved.map((f) => (
              <Badge key={f.name} variant="secondary" className="gap-1 font-normal">
                <span className="cursor-pointer" onClick={() => applySavedFilter(f)}>
                  {f.name}
                </span>
                {(savedNews.counts[`positions|${f.name}`] ?? 0) > 0 && (
                  <span className="shrink-0 rounded-full bg-red-500/15 px-1.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                    +{savedNews.counts[`positions|${f.name}`]} 新
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`删除筛选 ${f.name}`}
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
              <span className="inline-flex items-center gap-1">
                <Input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveFilter()}
                  placeholder={defaultFilterName}
                  className="h-7 w-32 text-xs"
                />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSaveFilter} aria-label="确认保存">
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
                  aria-label="取消保存"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </span>
            ) : (
              <Button
                variant="link"
                size="sm"
                className="h-auto min-h-11 p-0 text-xs sm:min-h-0"
                disabled={activeFilters.length === 0 && !deadlineView}
                onClick={() => {
                  setSaveName(defaultFilterName)
                  setSaveOpen(true)
                }}
              >
                <BookmarkPlus className="mr-0.5 h-3.5 w-3.5" />
                保存当前筛选
              </Button>
            )}
            {saveHint && <span className="text-muted-foreground">{saveHint}</span>}
            {exportTask ? (
              <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在导出…完成后自动下载
              </span>
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
                      导出
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleExport('csv')}>
                    导出 CSV{data && data.total > SYNC_EXPORT_MAX ? '（异步）' : ''}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('xlsx')}>
                    导出 Excel{data && data.total > SYNC_EXPORT_MAX ? '（异步）' : ''}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('csv', true)}>
                    全部导出 CSV（最多 5 万行）
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('xlsx', true)}>
                    全部导出 Excel（最多 5 万行）
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="link"
              size="sm"
              className="hidden h-auto p-0 text-xs sm:inline-flex"
              onClick={copyShareLink}
            >
              {copied ? (
                <>
                  <Check className="mr-0.5 h-3.5 w-3.5" />
                  已复制
                </>
              ) : (
                <>
                  <Link2 className="mr-0.5 h-3.5 w-3.5" />
                  复制筛选链接
                </>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="link" size="sm" className="h-11 p-0 text-xs sm:hidden">
                    <MoreHorizontal className="mr-0.5 h-3.5 w-3.5" />
                    更多
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem disabled={!!exportTask} onClick={() => handleExport('csv')}>
                  <Download className="h-4 w-4" />
                  <span className="flex flex-col whitespace-nowrap">
                    导出 CSV
                    {data && data.total > SYNC_EXPORT_MAX && (
                      <span className="text-[11px] text-muted-foreground">数据量大，转异步任务</span>
                    )}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!!exportTask} onClick={() => handleExport('xlsx')}>
                  <Download className="h-4 w-4" />
                  <span className="flex flex-col whitespace-nowrap">
                    导出 Excel
                    {data && data.total > SYNC_EXPORT_MAX && (
                      <span className="text-[11px] text-muted-foreground">数据量大，转异步任务</span>
                    )}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!!exportTask} onClick={() => handleExport('csv', true)}>
                  <Download className="h-4 w-4" />
                  <span className="flex flex-col whitespace-nowrap">
                    全部导出 CSV
                    <span className="text-[11px] text-muted-foreground">最多 5 万行</span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!!exportTask} onClick={() => handleExport('xlsx', true)}>
                  <Download className="h-4 w-4" />
                  <span className="flex flex-col whitespace-nowrap">
                    全部导出 Excel
                    <span className="text-[11px] text-muted-foreground">最多 5 万行</span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={copyShareLink}>
                  <Link2 className="h-4 w-4" />
                  <span className="whitespace-nowrap">复制筛选链接</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {activeChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">已选筛选：</span>
              {activeChips.map((chip, idx) => (
                <Badge key={idx} variant="secondary" className="gap-1 text-xs font-normal">
                  {chip.label}
                  <button
                    type="button"
                    aria-label={`移除 ${chip.label}`}
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                    onClick={chip.onRemove}
                  >
                    <X className="pointer-events-none h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Button variant="link" size="sm" className="h-auto min-h-11 p-0 text-xs sm:min-h-0" onClick={clearFilters}>
                清除全部
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <QuickMatch
        key={quickMatchKey}
        filters={filters}
        onSearch={applyQuickMatch}
        onReset={clearFilters}
        onRecommend={applyRecommend}
      />

      {recommendQuery && (
        <RecommendPanel query={recommendQuery} onClose={() => setRecommendQuery(null)} />
      )}

      {showStats && !deadlineView && <DeadlinesCard />}

      <div className="scrollbar-none -mx-1 flex items-center gap-2 overflow-x-auto px-1 py-0.5">
        {PRESET_VIEWS.map((preset) => {
          const active = isPresetActive(preset)
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyPreset(preset)}
              className={cn(
                'min-h-11 shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
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
            'min-h-11 shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0',
            params.hide_expired
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          )}
        >
          隐藏已截止
        </button>
        {crossPresets && crossPresets.length > 0 && onCrossPreset && (
          <>
            <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
            {crossPresets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onCrossPreset(p.key)}
                className="min-h-11 shrink-0 cursor-pointer rounded-full border border-dashed border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground sm:min-h-0"
              >
                {p.label}
              </button>
            ))}
          </>
        )}
      </div>

      {showStats && onCrossPreset && (
        <TodayGlance
          onCampus={() => onCrossPreset('recent7')}
          onCampusAll={() => onCrossPreset('all')}
          onBianzhi={() => onCrossPreset('bz:all')}
          onDeadline={() => setDeadlineView(true)}
        />
      )}

      {showStats && <RecommendSection />}

      {crossTotal > 0 && onCrossOpen && (
        <button
          type="button"
          onClick={() => onCrossOpen((params.keyword || '').trim())}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-left text-sm text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200 dark:hover:bg-sky-900"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span>
            换个板块看看：{crossLabel || '另一板块'}中另有{' '}
            <span className="font-semibold">{crossTotal.toLocaleString()}</span> 条与「
            {(params.keyword || '').trim()}」相关 →
          </span>
        </button>
      )}

      {deadlineView && <DeadlinesCard days={14} limit={100} defaultExpanded />}

      {!deadlineView && (
      <>
      {loadError && !loading && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <span>加载失败，服务器可能正忙，请重试</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => load()}>
            重试
          </Button>
        </div>
      )}
      {!loading &&
        !loadError &&
        data &&
        data.total === 0 &&
        ((params.location?.length ?? 0) > 0 || (params.province?.length ?? 0) > 0) && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <span>
              没有结果，可能是地域筛选（
              {[...(params.province ?? []), ...(params.location ?? [])].join('、')}
              ）与其他条件冲突
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setParams((p) => ({ ...p, location: [], province: undefined, page: 1 }))
              }}
            >
              清除地域筛选
            </Button>
          </div>
        )}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="shrink-0 whitespace-nowrap text-xl font-bold tracking-tight">{title}</h1>
          {data && (
            <Badge
              variant="secondary"
              className="text-sm font-medium"
              title={data.total_capped ? '结果超过 10,000 条，计数已达统计上限' : undefined}
            >
              共 {formatTotal(data.total, data.total_capped)} 条
              {data.total_capped && <span className="hidden sm:inline">（已达统计上限）</span>}
            </Badge>
          )}
          <FreshnessNote board="positions" />
        </div>
      </div>

      <FilterSummaryBar filters={activeFilters} onClearAll={clearFilters} />

      {data && !loading && data.total === 0 && (params.keyword || '').trim() && onOpenBoardKw && (
        <CrossBoardZeroHint from="positions" keyword={params.keyword || ''} onOpen={onOpenBoardKw} />
      )}

      {data?.timed_out && (
        <div
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
        >
          搜索超时，请换关键词（更具体的词或加筛选条件）
        </div>
      )}

      {view === 'table' && (
        <PositionTable
          emptyAction={emptyAction}
          highlight={params.keyword}
          data={data?.items || []}
          total={data?.total || 0}
          totalCapped={data?.total_capped}
          page={data?.page || 1}
          pageSize={data?.page_size || 20}
          loading={loading}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          columnFilters={columnFilters}
        />
      )}
      {view === 'card' && (
        <PositionCardGrid
          data={data?.items || []}
          loading={loading}
          emptyAction={emptyAction}
          highlight={params.keyword}
        />
      )}
      {view === 'list' && <VirtualPositionList fetcher={fetcher} params={params} />}

      {view === 'card' && data && data.total > 0 && (
        <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
          <div className="text-sm text-muted-foreground">
            共 <span className="font-medium text-foreground">{formatTotal(data.total, data.total_capped)}</span> 条 · 第{' '}
            <span className="font-medium text-foreground">
              {data.page}/{Math.max(1, Math.ceil(data.total / data.page_size))}
            </span>{' '}
            页
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-11 px-4 sm:h-8 sm:px-3"
              onClick={() => updateParam('page', Math.max(1, data.page - 1))}
              disabled={data.page <= 1}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 px-4 sm:h-8 sm:px-3"
              onClick={() => updateParam('page', data.page + 1)}
              disabled={data.page >= Math.ceil(data.total / data.page_size)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
      </>
      )}

      {showStats && (
        <StatsDashboard
          onSelectYear={(y) => updateParam('year', [y])}
          onSelectExamType={(t) => updateParam('exam_type_norm', [t])}
          onSelectProvince={(p) => updateParam('province', [p])}
        />
      )}

      {exportTask && (
        <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-popover px-4 py-2 text-sm shadow-lg">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          正在导出…完成后自动下载
        </div>
      )}
      {exportError && (
        <div className="fixed bottom-20 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 shadow-lg dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {exportError}
        </div>
      )}
    </div>
  )
}
