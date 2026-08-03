import { cn } from '@/lib/utils'
import { isNewSinceLastVisit, type VisitBoard } from '@/lib/lastVisit'

/** 相对上次访问新增的岗位小蓝点「新」徽章（首次访问不标）。 */
export function NewDot({
  board,
  createdAt,
  className,
}: {
  board: VisitBoard
  createdAt: string | null | undefined
  className?: string
}) {
  if (!isNewSinceLastVisit(board, createdAt)) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 align-middle text-[10px] font-medium text-primary',
        className,
      )}
      aria-label="上次访问后新增"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
      新
    </span>
  )
}
