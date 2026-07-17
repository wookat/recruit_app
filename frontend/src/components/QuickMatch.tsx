import { useState } from 'react'
import type { FilterOptions } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MultiSelect } from './MultiSelect'
import { Search, Sparkles, RotateCcw } from 'lucide-react'

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
}

const EDU_LEVELS = ['大专/中专', '本科', '硕士研究生', '博士研究生']
const CATEGORIES = ['公务员', '事业单位/事业编', '军队文职', '选调生', '国企/央企', '上市公司', '其他企业']
const YEARS = ['2027', '2026', '2025']

export function QuickMatch({ filters, onSearch, onReset }: QuickMatchProps) {
  const [eduLevel, setEduLevel] = useState<string[]>(['本科'])
  const [major, setMajor] = useState('')
  const [location, setLocation] = useState<string[]>([])
  const [category, setCategory] = useState<string[]>([])
  const [year, setYear] = useState<string[]>(['2027', '2026', '2025'])

  function handleSearch() {
    onSearch({ eduLevel, major: major.trim(), location, category, year })
  }

  function handleReset() {
    setEduLevel(['本科'])
    setMajor('')
    setLocation([])
    setCategory([])
    setYear(['2027', '2026', '2025'])
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
        { label: '热门城市', options: filters.hot_locations.slice(0, 60) },
        ...filters.location_tree.map((node) => ({ label: node.province, options: node.cities })),
      ]
    : undefined

  return (
    <Card className="overflow-hidden border-primary/10 bg-gradient-to-br from-primary/[0.03] to-muted/30">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold">一键匹配理想岗位</h2>
            <p className="text-xs text-muted-foreground">选择学历、专业、城市、目标类型，快速筛选最适合你的体制内工作</p>
          </div>
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
              <div className="h-9 animate-pulse rounded-md bg-muted" />
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
