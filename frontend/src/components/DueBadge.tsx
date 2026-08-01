import { Badge } from '@/components/ui/badge'
import { daysUntil } from '@/lib/deadline'

/** deadline_date 已过期显示灰色「已截止」，距今 ≤3 天显示红色「剩N天/今天截止」，二者互斥。 */
export function DueBadge({ date }: { date: string | null | undefined }) {
  if (!date) return null
  const d = new Date(`${date}T00:00:00`)
  if (isNaN(d.getTime())) return null
  const n = daysUntil(d)
  if (n < 0) {
    return (
      <Badge className="whitespace-nowrap border-0 bg-muted text-foreground/80 dark:text-muted-foreground">
        已截止
      </Badge>
    )
  }
  if (n > 3) return null
  return (
    <Badge className="whitespace-nowrap border-0 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
      {n === 0 ? '今天截止' : `剩${n}天`}
    </Badge>
  )
}
