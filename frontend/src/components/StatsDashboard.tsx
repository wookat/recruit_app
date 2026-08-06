import { t, tt } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { fetchStats, type Stats } from '@/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatsDashboardProps {
  onSelectYear?: (year: number) => void
  onSelectExamType?: (examType: string) => void
  onSelectProvince?: (province: string) => void
  /** 当前生效的筛选值，用于高亮看板里对应行的选中态 */
  selectedYear?: number
  selectedExamType?: string
  selectedProvinces?: string[]
  /** sidebar：右侧栏列表形态；card：页内卡片（默认） */
  variant?: 'card' | 'sidebar'
}

function StatList({
  title,
  entries,
  onSelect,
  max,
  isSelected,
}: {
  title: string
  entries: { name: string; count: number }[]
  onSelect?: (name: string) => void
  max?: number
  isSelected?: (name: string) => boolean
}) {
  const [showAll, setShowAll] = useState(false)
  if (entries.length === 0) return null
  const shown = showAll || !max ? entries : entries.slice(0, max)
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <ul className="divide-y divide-border/60">
        {shown.map((e) => (
          <li key={e.name}>
            <button
              type="button"
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded px-1 py-1.5 text-left text-xs hover:bg-muted',
                isSelected?.(e.name) && 'bg-primary/10 font-medium text-primary hover:bg-primary/10',
              )}
              aria-pressed={isSelected?.(e.name) || undefined}
              onClick={() => onSelect?.(e.name)}
            >
              <span className="truncate">{t(e.name)}</span>
              <span className={cn('shrink-0 tabular-nums text-muted-foreground', isSelected?.(e.name) && 'text-primary/80')}>{e.count.toLocaleString()}</span>
            </button>
          </li>
        ))}
      </ul>
      {max && entries.length > max && (
        <button
          type="button"
          className="w-full rounded px-1 py-1 text-left text-xs text-primary hover:bg-muted"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? t("收起") : tt`展开全部 ${entries.length} 项`}
        </button>
      )}
    </div>
  )
}

function StatGroup({
  title,
  entries,
  onSelect,
  isSelected,
}: {
  title: string
  entries: { name: string; count: number }[]
  onSelect?: (name: string) => void
  isSelected?: (name: string) => boolean
}) {
  if (entries.length === 0) return null
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {entries.map((e) => (
          <Badge
            key={e.name}
            variant="outline"
            className={cn(
              onSelect ? 'cursor-pointer gap-1 font-normal hover:bg-muted' : 'gap-1 font-normal',
              isSelected?.(e.name) && 'border-primary bg-primary/10 text-primary hover:bg-primary/10',
            )}
            onClick={() => onSelect?.(e.name)}
          >
            {t(e.name)}
            <span className={isSelected?.(e.name) ? 'text-primary/80' : 'text-muted-foreground'}>{e.count.toLocaleString()}</span>
          </Badge>
        ))}
      </div>
    </div>
  )
}

export function StatsDashboard({
  onSelectYear,
  onSelectExamType,
  onSelectProvince,
  selectedYear,
  selectedExamType,
  selectedProvinces,
  variant = 'card',
}: StatsDashboardProps) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch(() => setFailed(true))
  }, [])

  if (failed || !stats) return null

  if (variant === 'sidebar') {
    return (
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            {t("数据看板")}{' '}<Badge variant="secondary" className="font-normal">
              {stats.total.toLocaleString()} {' '}{t("条")}{' '}</Badge>
          </div>
          <StatList
            title={t("按年份（点击筛选）")}
            entries={stats.by_year}
            max={6}
            isSelected={(name) => Number(name) === selectedYear}
            onSelect={(name) => {
              const y = Number(name)
              if (!isNaN(y)) onSelectYear?.(y)
            }}
          />
          <StatList
            title={t("按考试类型（点击筛选）")}
            entries={stats.by_exam_type}
            max={8}
            isSelected={(name) => name === selectedExamType}
            onSelect={onSelectExamType}
          />
          <StatList
            title={t("按省份（点击筛选）")}
            entries={stats.by_province}
            max={8}
            isSelected={(name) => selectedProvinces?.includes(name) ?? false}
            onSelect={onSelectProvince}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            {t("数据看板")}{' '}<Badge variant="secondary" className="font-normal">
              {t("共")}{' '}{stats.total.toLocaleString()} {' '}{t("条岗位")}{' '}</Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto min-h-11 min-w-11 gap-1 px-3 text-xs text-muted-foreground sm:h-7 sm:min-h-0 sm:min-w-0 sm:px-2"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                {t("收起")}{' '}<ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                {t("展开")}{' '}<ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
        <StatGroup
          title={t("按年份（点击筛选）")}
          entries={stats.by_year.slice(0, expanded ? undefined : 6)}
          isSelected={(name) => Number(name) === selectedYear}
          onSelect={(name) => {
            const y = Number(name)
            if (!isNaN(y)) onSelectYear?.(y)
          }}
        />
        {expanded && (
          <>
            <StatGroup
              title={t("按考试类型（点击筛选）")}
              entries={stats.by_exam_type}
              isSelected={(name) => name === selectedExamType}
              onSelect={onSelectExamType}
            />
            <StatGroup
              title={t("按省份（点击筛选）")}
              entries={stats.by_province}
              isSelected={(name) => selectedProvinces?.includes(name) ?? false}
              onSelect={onSelectProvince}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}
