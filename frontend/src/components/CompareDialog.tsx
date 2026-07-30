import type { Position } from '@/api'
import { cn } from '@/lib/utils'
import { toggleCompare } from '@/lib/positionStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  items: Position[]
}

const COMPARE_FIELDS: { label: string; get: (p: Position) => string }[] = [
  { label: '年份', get: (p) => String(p.year || '-') },
  { label: '工作类型', get: (p) => p.job_type || '-' },
  { label: '考试/招聘类型', get: (p) => p.exam_type || '-' },
  { label: '用人单位/系统', get: (p) => p.employer || '-' },
  { label: '学历要求', get: (p) => p.edu_level_norm || p.edu_requirement || '-' },
  { label: '本科生专业要求', get: (p) => p.undergrad_major || '-' },
  { label: '研究生专业要求', get: (p) => p.grad_major || '-' },
  { label: '工作地点', get: (p) => p.work_location || '-' },
  { label: '报名时间', get: (p) => p.signup_time || '-' },
  { label: '考试时间', get: (p) => p.exam_time || '-' },
  { label: '考试/招聘形式', get: (p) => p.exam_form || '-' },
  { label: '特殊要求', get: (p) => p.special_requirements || '-' },
]

export function CompareDialog({ open, onClose, items }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>岗位对比（{items.length} 个）</DialogTitle>
        </DialogHeader>
        <div className="overflow-auto p-4" style={{ maxHeight: 'calc(85vh - 3.5rem)' }}>
          <div className="space-y-4 sm:hidden">
            {items.map((p) => (
              <div key={p.id} className="rounded-lg border">
                <div className="flex items-start justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-sm font-semibold leading-snug">
                      {p.position_example || p.exam_type || '-'}
                    </div>
                    <Badge variant="secondary" className="mt-1 text-[11px]">
                      {p.year}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    aria-label="移出对比"
                    onClick={() => toggleCompare(p)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <dl className="divide-y">
                  {COMPARE_FIELDS.map((field) => {
                    const values = items.map((x) => field.get(x))
                    const differs = new Set(values).size > 1
                    return (
                      <div
                        key={field.label}
                        className={cn('px-3 py-1.5', differs && 'bg-amber-50/60 dark:bg-amber-950/20')}
                      >
                        <dt className="text-[11px] font-medium text-muted-foreground">
                          {field.label}
                          {differs && <span className="ml-1 text-amber-600 dark:text-amber-400">≠</span>}
                        </dt>
                        <dd className="whitespace-pre-wrap text-sm leading-relaxed">{field.get(p)}</dd>
                      </div>
                    )
                  })}
                </dl>
              </div>
            ))}
          </div>
          <table className="hidden w-full min-w-[640px] border-collapse text-sm sm:table">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-32 bg-popover p-2 text-left text-xs font-medium text-muted-foreground">
                  字段
                </th>
                {items.map((p) => (
                  <th key={p.id} className="min-w-[180px] p-2 text-left align-top">
                    <div className="flex items-start justify-between gap-1">
                      <div>
                        <div className="line-clamp-2 font-semibold leading-snug">
                          {p.position_example || p.exam_type || '-'}
                        </div>
                        <Badge variant="secondary" className="mt-1 text-[11px]">
                          {p.year}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        aria-label="移出对比"
                        onClick={() => toggleCompare(p)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_FIELDS.map((field) => {
                const values = items.map((p) => field.get(p))
                const differs = new Set(values).size > 1
                return (
                  <tr key={field.label} className={cn('border-t', differs && 'bg-amber-50/60 dark:bg-amber-950/20')}>
                    <td className="sticky left-0 z-10 bg-popover p-2 text-xs font-medium text-muted-foreground">
                      {field.label}
                      {differs && <span className="ml-1 text-amber-600 dark:text-amber-400">≠</span>}
                    </td>
                    {values.map((v, i) => (
                      <td key={items[i].id} className="max-w-[260px] whitespace-pre-wrap p-2 align-top leading-relaxed">
                        {v}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
