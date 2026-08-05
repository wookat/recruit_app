import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { isNewSinceLastVisit, type VisitBoard } from '@/lib/lastVisit'
import { useSeenSet } from '@/lib/viewHistory'

/** 相对上次访问新增的岗位小蓝点「新」徽章（首次访问不标；已看过的岗位不标，与「已看」互斥）。 */
export function NewDot({
  board,
  id,
  createdAt,
  className,
}: {
  board: VisitBoard
  id: number
  createdAt: string | null | undefined
  className?: string
}) {
  const seen = useSeenSet()
  if (seen.has(`${board}:${id}`) || !isNewSinceLastVisit(board, createdAt)) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 align-middle text-[10px] font-medium text-primary',
        className,
      )}
      aria-label={t("上次访问后新增")}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
      {t("新")}{' '}</span>
  )
}
