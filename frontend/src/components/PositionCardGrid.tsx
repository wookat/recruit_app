import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { Position } from '@/api'
import { PositionCard } from './PositionCard'
import { LazyPositionSheet } from './LazyPositionSheet'
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

/** 单列（<640px）时用窗口虚拟列表只渲染可见卡片，保证移动端大页滑动流畅。 */
function useSingleColumn() {
  const [single, setSingle] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const onChange = () => setSingle(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return single
}

const CARD_ESTIMATE = 260

export const PositionCardGrid = memo(function PositionCardGrid({ data, loading, emptyAction, highlight, onTagClick }: Props) {
  const [selected, setSelected] = useState<Position | null>(null)
  const singleColumn = useSingleColumn()
  const listRef = useRef<HTMLDivElement>(null)
  const virtualize = singleColumn && data.length > 12
  const virtualizer = useWindowVirtualizer({
    count: virtualize ? data.length : 0,
    estimateSize: () => CARD_ESTIMATE,
    overscan: 5,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  })

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
      {virtualize ? (
        <div ref={listRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const item = data[vi.index]
            return (
              <div
                key={item.id}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full pb-4"
                style={{ transform: `translateY(${vi.start - virtualizer.options.scrollMargin}px)` }}
              >
                <PositionCard item={item} onDetail={setSelected} highlight={highlight} />
              </div>
            )
          })}
        </div>
      ) : (
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
      )}
      {selected && (
        <LazyPositionSheet
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
