import { useEffect, useState } from 'react'
import { fetchStats, type Stats } from '@/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react'

interface StatsDashboardProps {
  onSelectYear?: (year: number) => void
  onSelectExamType?: (examType: string) => void
  onSelectProvince?: (province: string) => void
}

function StatGroup({
  title,
  entries,
  onSelect,
}: {
  title: string
  entries: { name: string; count: number }[]
  onSelect?: (name: string) => void
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
            className={onSelect ? 'cursor-pointer gap-1 font-normal hover:bg-muted' : 'gap-1 font-normal'}
            onClick={() => onSelect?.(e.name)}
          >
            {e.name}
            <span className="text-muted-foreground">{e.count.toLocaleString()}</span>
          </Badge>
        ))}
      </div>
    </div>
  )
}

export function StatsDashboard({ onSelectYear, onSelectExamType, onSelectProvince }: StatsDashboardProps) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch(() => setFailed(true))
  }, [])

  if (failed || !stats) return null

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            数据看板
            <Badge variant="secondary" className="font-normal">
              共 {stats.total.toLocaleString()} 条岗位
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                收起 <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                展开 <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
        <StatGroup
          title="按年份（点击筛选）"
          entries={stats.by_year.slice(0, expanded ? undefined : 6)}
          onSelect={(name) => {
            const y = Number(name)
            if (!isNaN(y)) onSelectYear?.(y)
          }}
        />
        {expanded && (
          <>
            <StatGroup title="按考试类型（点击筛选）" entries={stats.by_exam_type} onSelect={onSelectExamType} />
            <StatGroup title="按省份（点击筛选）" entries={stats.by_province} onSelect={onSelectProvince} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
