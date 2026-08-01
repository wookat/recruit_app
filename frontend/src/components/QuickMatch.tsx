import { useState } from 'react'
import type { FilterOptions } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MultiSelect } from './MultiSelect'
import { Search, Sparkles, RotateCcw, Wand2, ChevronDown, ChevronUp } from 'lucide-react'
import { clearProfile, getProfile, saveProfile } from '@/lib/profile'

export interface QuickMatchValues {
  eduLevel: string[]
  major: string
  location: string[]
  category: string[]
  year: string[]
}

interface QuickMatchProps {
  filters: FilterOptions | null
  onSearch: (values: QuickMatchValues) => void
  onReset: () => void
  onRecommend?: (values: QuickMatchValues) => void
}

const EDU_LEVELS = ['大专/中专', '本科', '硕士研究生', '博士研究生']
const CATEGORIES = ['公务员', '事业单位/事业编', '军队文职', '选调生', '国企/央企', '上市公司', '其他企业']
const YEARS = ['2027', '2026', '2025']
const HOT_CITIES = [
  '北京', '上海', '广州', '深圳', '杭州', '南京', '成都', '武汉',
  '西安', '苏州', '天津', '重庆', '长沙', '青岛', '郑州', '合肥',
]

export function QuickMatch({ filters, onSearch, onReset, onRecommend }: QuickMatchProps) {
  const [open, setOpen] = useState(false)
  const [eduLevel, setEduLevel] = useState<string[]>(() => getProfile().eduLevel)
  const [major, setMajor] = useState(() => getProfile().major)
  const [location, setLocation] = useState<string[]>(() => getProfile().location)
  const [category, setCategory] = useState<string[]>([])
  const [year, setYear] = useState<string[]>(['2027', '2026', '2025'])

  function handleSearch() {
    saveProfile({ eduLevel, major: major.trim(), location })
    onSearch({ eduLevel, major: major.trim(), location, category, year })
  }

  function handleRecommend() {
    if (!major.trim() || !onRecommend) return
    saveProfile({ eduLevel, major: major.trim(), location })
    onRecommend({ eduLevel, major: major.trim(), location, category, year })
  }

  function handleReset() {
    setEduLevel([])
    setMajor('')
    setLocation([])
    setCategory([])
    setYear(['2027', '2026', '2025'])
    clearProfile()
    onReset()
  }

  function toggleYear(y: string) {
    setYear((prev) => (prev.includes(y) ? prev.filter((v) => v !== y) : [...prev, y]))
  }

  function toggleCategory(c: string) {
    setCategory((prev) => (prev.includes(c) ? prev.filter((v) => v !== c) : [...prev, c]))
  }

  const locationGroups = filters
    ? [
        {
          label: '热门城市',
          options: [
            ...HOT_CITIES,
            ...filters.hot_locations.filter((c) => !HOT_CITIES.includes(c)),
          ].slice(0, 60),
        },
        ...filters.location_tree.map((node) => ({ label: node.province, options: node.cities })),
      ]
    : undefined

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-primary/10 bg-gradient-to-br from-primary/[0.03] to-muted/30 px-4 py-3 text-left transition-all hover:bg-muted/50 active:scale-[0.995]"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">一键匹配理想岗位</div>
          <div className="line-clamp-1 text-xs text-muted-foreground">按学历、专业、城市、目标类型快速筛选</div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    )
  }

  return (
    <Card className="overflow-hidden border-primary/10 bg-gradient-to-br from-primary/[0.03] to-muted/30">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">一键匹配理想岗位</h2>
            <p className="text-xs text-muted-foreground">选择学历、专业、城市、目标类型，快速筛选最适合你的体制内工作</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 text-xs text-muted-foreground"
            onClick={() => setOpen(false)}
          >
            收起 <ChevronUp className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">学历要求</label>
            <MultiSelect
              label=""
              options={EDU_LEVELS}
              selected={eduLevel}
              onChange={setEduLevel}
              placeholder="选择学历…"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">专业关键词</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="如：计算机、法学、会计"
                value={major}
                onChange={(e) => setMajor(e.target.value)}
                className="h-9 pl-9"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch()
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">意向城市/省份</label>
            {filters ? (
              <MultiSelect
                label=""
                groups={locationGroups}
                selected={location}
                onChange={setLocation}
                placeholder="选择城市或省份…"
              />
            ) : (
              <div className="h-9 animate-pulse rounded-lg bg-muted" />
            )}
          </div>

          <div className="flex flex-col gap-1.5 lg:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">目标岗位类型</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <Badge
                  key={c}
                  variant={category.includes(c) ? 'default' : 'outline'}
                  className="cursor-pointer text-xs"
                  onClick={() => toggleCategory(c)}
                >
                  {c}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">年份：</span>
            {YEARS.map((y) => (
              <Badge
                key={y}
                variant={year.includes(y) ? 'default' : 'outline'}
                className="cursor-pointer text-xs"
                onClick={() => toggleYear(y)}
              >
                {y}届
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-9" onClick={handleReset}>
              <RotateCcw className="mr-1 h-4 w-4" />
              重置
            </Button>
            {onRecommend && (
              <Button
                variant="secondary"
                size="sm"
                className="h-9"
                onClick={handleRecommend}
                disabled={!major.trim()}
                title={major.trim() ? '根据专业智能推荐岗位' : '请先输入专业关键词'}
              >
                <Wand2 className="mr-1 h-4 w-4" />
                智能推荐
              </Button>
            )}
            <Button size="sm" className="h-9" onClick={handleSearch}>
              <Search className="mr-1 h-4 w-4" />
              一键匹配
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
