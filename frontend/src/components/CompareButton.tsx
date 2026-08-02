import type { Position } from '@/api'
import { Scale } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  BOARD_COMPARE_MAX,
  isBoardCompared,
  toggleBoardCompare,
  useBoardCompare,
} from '@/lib/boardCompare'
import { Button } from '@/components/ui/button'

interface Props {
  item: Position
  className?: string
}

/** 体制内列表行「加入对比」按钮：与校招/编制共用跨板块对比栏。 */
export function CompareButton({ item, className }: Props) {
  const compare = useBoardCompare()
  const active = isBoardCompared('positions', item.id)
  const full = !active && compare.length >= BOARD_COMPARE_MAX
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={active ? '移出对比' : '加入对比'}
      title={full ? `最多对比 ${BOARD_COMPARE_MAX} 条` : active ? '移出对比' : '加入对比'}
      className={cn('h-11 w-11 sm:h-8 sm:w-8', full && 'opacity-50', className)}
      onClick={(e) => {
        e.stopPropagation()
        toggleBoardCompare({ board: 'positions', job: item })
      }}
    >
      <Scale className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} />
    </Button>
  )
}
