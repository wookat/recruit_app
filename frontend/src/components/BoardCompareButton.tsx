import { Scale } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  BOARD_COMPARE_MAX,
  isBoardCompared,
  toggleBoardCompare,
  useBoardCompare,
  type BoardCompareItem,
} from '@/lib/boardCompare'

interface Props {
  item: BoardCompareItem
  className?: string
}

/** 列表行「加入对比」按钮（行数据快照，不要求收藏，三板块混合）。 */
export function BoardCompareButton({ item, className }: Props) {
  const compare = useBoardCompare()
  const active = isBoardCompared(item.board, item.job.id)
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
        toggleBoardCompare(item)
      }}
    >
      <Scale className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} />
    </Button>
  )
}
