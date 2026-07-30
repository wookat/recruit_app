import { useEffect, useState } from 'react'
import { fetchRecommend, type RecommendResult } from '@/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PositionCardGrid } from './PositionCardGrid'
import { Wand2, X } from 'lucide-react'

export interface RecommendQuery {
  major: string
  edu_level?: string[]
  location?: string[]
  category?: string[]
  year?: number[]
}

interface RecommendPanelProps {
  query: RecommendQuery
  onClose: () => void
}

const SCORE_LABEL: Record<number, string> = {
  3: '精确匹配',
  2: '同类专业',
  1: '专业不限',
}

export function RecommendPanel({ query, onClose }: RecommendPanelProps) {
  const [result, setResult] = useState<RecommendResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    fetchRecommend({ ...query, limit: 30 })
      .then((r) => {
        if (!cancelled) setResult(r)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query])

  const scoreCounts = new Map<number, number>()
  for (const item of result?.items || []) {
    scoreCounts.set(item.match_score, (scoreCounts.get(item.match_score) || 0) + 1)
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/[0.04] to-muted/20">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Wand2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">
                “{query.major}” 专业智能推荐
                {result && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    共 {result.total} 条
                  </span>
                )}
              </h2>
              <p className="text-xs text-muted-foreground">
                按 精确匹配 &gt; 同类专业 &gt; 专业不限 排序，自动扩展同大类相关专业
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="关闭推荐">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {result && result.expanded_terms.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">相关专业：</span>
            {result.expanded_terms.map((t) => (
              <Badge key={t} variant={t === query.major ? 'default' : 'outline'} className="text-xs">
                {t}
              </Badge>
            ))}
          </div>
        )}

        {result && scoreCounts.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">匹配度：</span>
            {[3, 2, 1]
              .filter((s) => scoreCounts.has(s))
              .map((s) => (
                <Badge key={s} variant="secondary" className="text-xs">
                  {SCORE_LABEL[s]} × {scoreCounts.get(s)}
                </Badge>
              ))}
          </div>
        )}

        {loading && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-xl" />
            ))}
          </div>
        )}
        {error && <p className="text-sm text-destructive">推荐加载失败，请稍后重试。</p>}
        {!loading && !error && result && result.items.length === 0 && (
          <p className="text-sm text-muted-foreground">没有找到匹配的岗位，试试换个专业关键词。</p>
        )}
        {!loading && result && result.items.length > 0 && (
          <PositionCardGrid data={result.items} loading={false} />
        )}
      </CardContent>
    </Card>
  )
}
