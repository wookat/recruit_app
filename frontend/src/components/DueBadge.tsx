import { Badge } from '@/components/ui/badge'
import { daysUntil } from '@/lib/deadline'
import { useRemindDays } from '@/lib/reminderPref'

/** deadline_date 已过期显示灰色「已截止」；距今 ≤3 天红色，4 天至 max(7, 提醒天数偏好) 天 amber。 */
export function DueBadge({ date }: { date: string | null | undefined }) {
  const remindDays = useRemindDays()
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
  if (n <= 3) {
    return (
      <Badge className="whitespace-nowrap border-0 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
        {n === 0 ? '今天截止' : `剩${n}天`}
      </Badge>
    )
  }
  if (n <= Math.max(7, remindDays)) {
    return (
      <Badge className="whitespace-nowrap border-0 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        {`剩${n}天`}
      </Badge>
    )
  }
  return null
}
