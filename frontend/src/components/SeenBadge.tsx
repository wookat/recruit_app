import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useSeenSet, type HistoryBoard } from '@/lib/viewHistory'

/** 已浏览过的岗位低调灰标（O(1) Set 查表）。 */
export function SeenBadge({
  board,
  id,
  className,
}: {
  board: HistoryBoard
  id: number
  className?: string
}) {
  const seen = useSeenSet()
  if (!seen.has(`${board}:${id}`)) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm bg-muted px-1.5 py-px align-middle text-[10px] font-normal text-muted-foreground',
        className,
      )}
      aria-label={t("已浏览过")}
    >
      {t("已看")}{' '}</span>
  )
}
