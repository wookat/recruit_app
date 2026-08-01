import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'

export interface FavCompareColumn {
  key: string
  title: string
  badge?: string
  fields: { label: string; value: string }[]
  onRemove: () => void
  onOpenDetail: () => void
}

/** 收藏对比视图：同板块 2-3 条并排字段，差异高亮，列头可移除/直开详情，窄屏横向滑动。 */
export function FavCompareDialog({
  open,
  onClose,
  columns,
}: {
  open: boolean
  onClose: () => void
  columns: FavCompareColumn[]
}) {
  const labels = columns[0]?.fields.map((f) => f.label) ?? []
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>收藏对比（{columns.length} 条）</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <div
            className="overflow-auto p-4 max-sm:px-0 [scrollbar-width:thin]"
            style={{ maxHeight: 'calc(85vh - 3.5rem)' }}
          >
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-24 bg-popover p-2 text-left text-xs font-medium text-muted-foreground max-sm:pl-4">
                  字段
                </th>
                {columns.map((c) => (
                  <th key={c.key} className="min-w-[160px] p-2 text-left align-top">
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="line-clamp-2 cursor-pointer text-left font-semibold leading-snug underline-offset-2 hover:text-primary hover:underline"
                          title="查看详情"
                          onClick={c.onOpenDetail}
                        >
                          {c.title}
                        </button>
                        {c.badge && (
                          <Badge variant="secondary" className="mt-1 text-[11px]">
                            {c.badge}
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        aria-label="移出对比"
                        onClick={c.onRemove}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((label, i) => {
                const values = columns.map((c) => c.fields[i]?.value ?? '-')
                const differs = new Set(values).size > 1
                return (
                  <tr
                    key={label}
                    className={cn('border-t', differs && 'bg-amber-50/60 dark:bg-amber-950/20')}
                  >
                    <td className="sticky left-0 z-10 bg-popover p-2 text-xs font-medium text-muted-foreground max-sm:pl-4">
                      {label}
                      {differs && (
                        <span className="ml-1 text-amber-600 dark:text-amber-400">≠</span>
                      )}
                    </td>
                    {values.map((v, j) => (
                      <td
                        key={columns[j].key}
                        className="max-w-[240px] whitespace-pre-wrap p-2 align-top leading-relaxed"
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-popover to-transparent sm:hidden"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
