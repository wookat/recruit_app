import type { Position } from '@/api'
import { ExternalLink } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'

interface Props {
  item: Position | null
  onClose: () => void
}

export function PositionSheet({ item, onClose }: Props) {
  if (!item) return null

  const fields = [
    { label: '年份', value: item.year },
    { label: '工作类型', value: item.job_type },
    { label: '考试/招聘类型', value: item.exam_type },
    { label: '用人单位/系统', value: item.employer },
    { label: '岗位示例', value: item.position_example },
    { label: '学历要求（归一）', value: item.edu_level_norm },
    { label: '学历要求（原始）', value: item.edu_requirement },
    { label: '本科生专业要求', value: item.undergrad_major },
    { label: '研究生专业要求', value: item.grad_major },
    { label: '专业要求（原始）', value: item.raw_major },
    { label: '考试/招聘形式', value: item.exam_form },
    { label: '报名时间', value: item.signup_time },
    { label: '笔试/考试时间', value: item.exam_time },
    { label: '特殊要求', value: item.special_requirements },
    { label: '工作地点', value: item.work_location },
    { label: '备注', value: item.notes },
  ]

  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-2xl p-0 sm:max-w-xl">
        <SheetHeader className="px-6 pt-6">
          <SheetTitle className="flex flex-wrap items-center gap-2 text-lg">
            岗位详情
            <Badge variant="secondary">{item.year}</Badge>
            <Badge variant="outline">{item.job_type}</Badge>
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-5rem)] px-6">
          <div className="space-y-4 pb-6">
            {fields.map((f) =>
              f.value ? (
                <div key={f.label}>
                  <div className="text-xs font-medium text-muted-foreground">{f.label}</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                    {typeof f.value === 'number' ? String(f.value) : f.value}
                  </div>
                </div>
              ) : null
            )}
            {item.source_url && (
              <div>
                <div className="text-xs font-medium text-muted-foreground">信息来源</div>
                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center break-all text-sm text-primary hover:underline"
                >
                  {item.source_url}
                  <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
