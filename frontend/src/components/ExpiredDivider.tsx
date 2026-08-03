import { TableCell, TableRow } from '@/components/ui/table'
import { daysUntil } from '@/lib/deadline'

/** deadline_date 早于今天视为已截止；无日期视为未截止。 */
export function isExpiredDate(date: string | null | undefined): boolean {
  if (!date) return false
  const d = new Date(`${date}T00:00:00`)
  if (isNaN(d.getTime())) return false
  return daysUntil(d) < 0
}

function DividerContent({ onHide }: { onHide: () => void }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      以下为已截止岗位
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onHide()
        }}
        className="min-h-11 rounded-full border border-border bg-background px-3 py-0.5 text-[11px] text-foreground transition-colors hover:bg-muted sm:min-h-0 sm:px-2"
      >
        隐藏已截止
      </button>
    </span>
  )
}

/** 表格视图中已截止分界行。 */
export function ExpiredDividerRow({ onHide }: { onHide: () => void }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={99} className="bg-muted/40 py-1.5 text-xs font-medium text-muted-foreground">
        <DividerContent onHide={onHide} />
      </TableCell>
    </TableRow>
  )
}

/** 卡片视图中已截止分界提示。 */
export function ExpiredDividerBlock({ onHide }: { onHide: () => void }) {
  return (
    <div className="pt-1 text-xs font-medium text-muted-foreground">
      <DividerContent onHide={onHide} />
    </div>
  )
}
