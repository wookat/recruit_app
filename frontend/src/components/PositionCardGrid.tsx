import { memo, useState, type ReactNode } from 'react'
import type { Position } from '@/api'
import { PositionCard } from './PositionCard'
import { PositionSheet } from './PositionSheet'
import { sheetNavProps } from '@/lib/sheetNav'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { EmptyState } from './EmptyState'

interface Props {
  data: Position[]
  loading: boolean
  emptyAction?: ReactNode
  highlight?: string
  onTagClick?: (tagKey: string) => void
}

export const PositionCardGrid = memo(function PositionCardGrid({ data, loading, emptyAction, highlight, onTagClick }: Props) {
  const [selected, setSelected] = useState<Position | null>(null)

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="flex flex-col">
            <CardHeader className="space-y-2 pb-2">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-12 rounded-4xl" />
                <Skeleton className="h-5 w-20 rounded-4xl" />
              </div>
              <Skeleton className="h-5 w-4/5" />
            </CardHeader>
            <CardContent className="flex-1 space-y-2.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
            <CardFooter className="pt-0">
              <Skeleton className="h-8 w-full rounded-lg" />
            </CardFooter>
          </Card>
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title="没有找到匹配的岗位"
        description="建议优先移除关键词，其次地区、类型筛选"
        action={emptyAction}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((item, i) => (
          <div
            key={item.id}
            className="h-full animate-fade-in-up"
            style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}
          >
            <PositionCard item={item} onDetail={setSelected} highlight={highlight} />
          </div>
        ))}
      </div>
      {selected && (
        <PositionSheet
          item={selected}
          onClose={() => setSelected(null)}
          {...sheetNavProps(data, selected, setSelected)}
          onOpenItem={setSelected}
          onTagClick={onTagClick}
        />
      )}
    </div>
  )
})
