import type { Position } from '@/api'
import { Scale } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COMPARE_MAX, toggleCompare, useCompare } from '@/lib/positionStore'
import { Button } from '@/components/ui/button'

interface Props {
  item: Position
  className?: string
}

export function CompareButton({ item, className }: Props) {
  const compare = useCompare()
  const active = compare.some((p) => p.id === item.id)
  const full = !active && compare.length >= COMPARE_MAX
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={active ? '移出对比' : '加入对比'}
      title={full ? `最多对比 ${COMPARE_MAX} 个岗位` : active ? '移出对比' : '加入对比'}
      aria-disabled={full}
      className={cn('h-11 w-11 sm:h-8 sm:w-8', full && 'opacity-50', className)}
      onClick={(e) => {
        e.stopPropagation()
        if (full) return
        toggleCompare(item)
      }}
    >
      <Scale className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} />
    </Button>
  )
}
