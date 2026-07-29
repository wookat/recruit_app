import { useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Position, PositionList, SearchParams } from '@/api'
import { PositionSheet } from './PositionSheet'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Building2, MapPin, GraduationCap, Loader2 } from 'lucide-react'

interface Props {
  fetcher: (params: SearchParams) => Promise<PositionList>
  params: SearchParams
  pageSize?: number
}

const ROW_ESTIMATE = 96

export function VirtualPositionList({ fetcher, params, pageSize = 100 }: Props) {
  const [items, setItems] = useState<Position[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Position | null>(null)
  const pageRef = useRef(1)
  const abortRef = useRef<AbortController | null>(null)
  const parentRef = useRef<HTMLDivElement>(null)

  const loadPage = useCallback(
    async (page: number, replace: boolean) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      try {
        const res = await fetcher({ ...params, page, page_size: pageSize })
        if (controller.signal.aborted) return
        pageRef.current = page
        setTotal(res.total)
        setItems((prev) => (replace ? res.items : [...prev, ...res.items]))
      } catch (e) {
        if (!controller.signal.aborted) console.error(e)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [fetcher, params, pageSize],
  )

  useEffect(() => {
    const t = setTimeout(() => {
      setItems([])
      setTotal(0)
      parentRef.current?.scrollTo({ top: 0 })
      loadPage(1, true)
    }, 300)
    return () => {
      clearTimeout(t)
      abortRef.current?.abort()
    }
  }, [loadPage])

  const hasMore = items.length < total

  const virtualizer = useVirtualizer({
    count: hasMore ? items.length + 1 : items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1]
    if (!last) return
    if (last.index >= items.length - 1 && hasMore && !loading) {
      loadPage(pageRef.current + 1, false)
    }
  }, [virtualItems, items.length, hasMore, loading, loadPage])

  if (loading && items.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (!loading && items.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border bg-card text-muted-foreground">
        暂无数据
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
        <span>
          已加载 <span className="font-medium text-foreground">{items.length.toLocaleString()}</span> /{' '}
          {total.toLocaleString()} 条 · 滚动自动加载
        </span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>
      <div ref={parentRef} className="h-[70vh] overflow-y-auto overscroll-contain">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((vi) => {
            const item = items[vi.index]
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                {item ? (
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted"
                    onClick={() => setSelected(item)}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-[11px]">
                        {item.year}
                      </Badge>
                      <Badge variant="outline" className="text-[11px]">
                        {item.job_type || '-'}
                      </Badge>
                      <span className="line-clamp-1 text-sm font-medium">
                        {item.position_example || item.exam_type || '-'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex max-w-[60%] items-center gap-1">
                        <Building2 className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item.employer || '-'}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <GraduationCap className="h-3.5 w-3.5 shrink-0" />
                        {item.edu_level_norm || item.edu_requirement || '不限'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item.work_location || '-'}</span>
                      </span>
                    </div>
                  </button>
                ) : (
                  <div className="flex items-center justify-center gap-2 px-4 py-4 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载中…
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {selected && <PositionSheet item={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
