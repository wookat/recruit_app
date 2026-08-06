import { t, tt } from '@/lib/i18n'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { Position } from '@/api'
import { PositionCard } from './PositionCard'
import { LazyPositionSheet } from './LazyPositionSheet'
import { sheetNavProps } from '@/lib/sheetNav'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { EmptyState } from './EmptyState'
import { foldPositions } from '@/lib/positionFold'
import { ChevronUp } from 'lucide-react'

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

export const PositionCardGrid = memo(function PositionCardGrid({ data: rawData, loading, emptyAction, highlight, onTagClick }: Props) {
  const [selected, setSelected] = useState<Position | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const { rows: data, groups, collapsedGroups, hiddenRows } = useMemo(
    () => foldPositions(rawData, expandedGroups),
    [rawData, expandedGroups],
  )
  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const singleColumn = useSingleColumn()
  const listRef = useRef<HTMLDivElement>(null)
  const virtualize = singleColumn && data.length > 12
  const virtualizer = useWindowVirtualizer({
    count: data.length,
    enabled: virtualize,
    estimateSize: () => CARD_ESTIMATE,
    overscan: 5,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  })

  if (loading && data.length === 0) {
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
              <Skeleton className="ml-auto h-8 w-24 rounded-lg" />
            </CardFooter>
          </Card>
        ))}
      </div>
    )
  }

  if (data.length === 0 && !loading) {
    return (
      <EmptyState
        title={t("没有找到匹配的岗位")}
        description={t("建议优先移除关键词，其次地区、类型筛选")}
        action={emptyAction}
      />
    )
  }

  return (
    <div className={loading ? 'space-y-3 opacity-50 transition-opacity' : 'space-y-3'}>
      {(collapsedGroups > 0 || expandedGroups.size > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          {collapsedGroups > 0 ? (
            <span>{tt`本页已折叠 ${collapsedGroups} 组同岗多地区岗位（${hiddenRows} 条），总数按未折叠口径统计`}</span>
          ) : (
            <span />
          )}
          {expandedGroups.size > 0 && (
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => setExpandedGroups(new Set())}
            >
              <ChevronUp className="h-3.5 w-3.5" />
              {t('折叠多地区岗位')}
            </button>
          )}
        </div>
      )}
      {virtualize ? (
        <div key="virtual" ref={listRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
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
                <PositionCard
                  item={item}
                  onDetail={setSelected}
                  highlight={highlight}
                  foldGroup={groups.get(item.id)}
                  onFoldToggle={toggleGroup}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div key="grid" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((item, i) => (
            <div
              key={item.id}
              className="h-full animate-fade-in-up"
              style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}
            >
              <PositionCard
                item={item}
                onDetail={setSelected}
                highlight={highlight}
                foldGroup={groups.get(item.id)}
                onFoldToggle={toggleGroup}
              />
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
