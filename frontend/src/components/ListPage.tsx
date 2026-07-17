import { useEffect, useState, useCallback } from 'react'
import { fetchFilters, type PositionList, type FilterOptions, type SearchParams } from '@/api'
import { MultiSelect } from './MultiSelect'
import { PositionTable } from './PositionTable'
import { PositionCardGrid } from './PositionCardGrid'
import { QuickMatch, type QuickMatchValues } from './QuickMatch'
import { LocationFilter } from './LocationFilter'
import { Search, Filter, X, RotateCcw, LayoutGrid, Table2, TrendingUp } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

interface ListPageProps {
  title: string
  fetcher: (params: SearchParams) => Promise<PositionList>
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

export function ListPage({ title, fetcher }: ListPageProps) {
  const [filters, setFilters] = useState<FilterOptions | null>(null)
  const [data, setData] = useState<PositionList | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'table' | 'card'>('table')
  const [filterOpen, setFilterOpen] = useState(false)
  const [params, setParams] = useState<SearchParams>({ ...DEFAULT_PARAMS })

  useEffect(() => {
    fetchFilters().then(setFilters).catch(console.error)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetcher(params)
      setData(res)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [fetcher, params])

  useEffect(() => {
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [load])

  function updateParam<K extends keyof SearchParams>(key: K, value: SearchParams[K]) {
    setParams((p) => {
      const next = { ...p, [key]: value }
      if (key !== 'page' && key !== 'page_size') next.page = 1
      return next as SearchParams
    })
  }

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
    }))
  }

  function clearFilters() {
    setParams({ ...DEFAULT_PARAMS })
  }

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
              <SelectTrigger className="h-9">
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
      <QuickMatch filters={filters} onSearch={applyQuickMatch} onReset={clearFilters} />

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="搜索岗位、单位、专业、地点、特殊要求…"
                value={params.keyword || ''}
                onChange={(e) => updateParam('keyword', e.target.value)}
                className="pl-9"
                onKeyDown={(e) => e.key === 'Enter' && load()}
              />
            </div>
            <div className="flex items-center gap-2">
              <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
                <SheetTrigger
                  render={
                    <Button variant="outline" size="icon" className="shrink-0 lg:hidden" aria-label="筛选">
                      <Filter className="h-4 w-4" />
                    </Button>
                  }
                />
                <SheetContent side="left" className="w-[340px] overflow-y-auto">
                  <SheetHeader>
                    <SheetTitle>高级筛选</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4 space-y-4">{advancedFilterPanel}</div>
                </SheetContent>
              </Sheet>
              <Button
                variant={view === 'card' ? 'default' : 'outline'}
                size="icon"
                className="h-9 w-9"
                aria-label="卡片视图"
                onClick={() => setView('card')}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={view === 'table' ? 'default' : 'outline'}
                size="icon"
                className="h-9 w-9"
                aria-label="表格视图"
                onClick={() => setView('table')}
              >
                <Table2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="hidden lg:block">{advancedFilterPanel}</div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">热门搜索：</span>
            {HOT_SEARCH.map((item) => (
              <Badge
                key={item.label}
                variant="outline"
                className="cursor-pointer hover:bg-muted"
                onClick={() => handleHotSearch(item)}
              >
                {item.label}
              </Badge>
            ))}
          </div>

          {activeChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">已选条件：</span>
              {activeChips.map((chip, idx) => (
                <Badge key={idx} variant="secondary" className="gap-1 text-xs font-normal">
                  {chip.label}
                  <X className="h-3 w-3 cursor-pointer" onClick={chip.onRemove} />
                </Badge>
              ))}
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={clearFilters}>
                清空全部
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {data && (
            <Badge variant="secondary" className="text-sm font-medium">
              共 {data.total.toLocaleString()} 条
            </Badge>
          )}
        </div>
      </div>

      {view === 'table' ? (
        <PositionTable
          data={data?.items || []}
          total={data?.total || 0}
          page={data?.page || 1}
          pageSize={data?.page_size || 20}
          loading={loading}
          onPageChange={(page) => updateParam('page', page)}
          onPageSizeChange={(size) => updateParam('page_size', size)}
        />
      ) : (
        <PositionCardGrid data={data?.items || []} loading={loading} />
      )}

      {view === 'card' && data && data.total > 0 && (
        <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
          <div className="text-sm text-muted-foreground">
            共 <span className="font-medium text-foreground">{data.total.toLocaleString()}</span> 条 · 第{' '}
            <span className="font-medium text-foreground">
              {data.page}/{Math.max(1, Math.ceil(data.total / data.page_size))}
            </span>{' '}
            页
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateParam('page', Math.max(1, data.page - 1))}
              disabled={data.page <= 1}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateParam('page', data.page + 1)}
              disabled={data.page >= Math.ceil(data.total / data.page_size)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
