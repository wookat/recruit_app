import { useState } from 'react'
import type { Position } from '@/api'
import { PositionCard } from './PositionCard'
import { PositionSheet } from './PositionSheet'
import { Skeleton } from '@/components/ui/skeleton'

interface Props {
  data: Position[]
  loading: boolean
}

export function PositionCardGrid({ data, loading }: Props) {
  const [selected, setSelected] = useState<Position | null>(null)

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-56 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border bg-card text-muted-foreground">
        暂无数据
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((item) => (
          <PositionCard key={item.id} item={item} onDetail={setSelected} />
        ))}
      </div>
      {selected && <PositionSheet item={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
