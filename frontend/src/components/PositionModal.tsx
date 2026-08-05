import { t } from '@/lib/i18n'
import type { Position } from '@/api'
import { ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { stripOrgPrefix } from '@/lib/orgPrefix'

interface Props {
  item: Position | null
  onClose: () => void
}

export function PositionModal({ item, onClose }: Props) {
  if (!item) return null

  const fields = [
    { label: t("年份"), value: item.year },
    { label: t("岗位类型"), value: item.job_type },
    { label: t("考试/招聘类型"), value: item.exam_type_norm || item.exam_type },
    { label: t("用人单位/系统"), value: item.employer },
    {
      label: t("岗位示例"),
      value: item.position_example ? stripOrgPrefix(item.position_example, item.employer) : item.position_example,
    },
    { label: t("学历要求"), value: item.edu_requirement },
    { label: t("本科生专业要求"), value: item.undergrad_major },
    { label: t("研究生专业要求"), value: item.grad_major },
    { label: t("专业要求（原始）"), value: item.raw_major },
    { label: t("考试/招聘形式"), value: item.exam_form },
    { label: t("报名时间"), value: item.signup_time },
    { label: t("笔试/考试时间"), value: item.exam_time },
    { label: t("特殊要求"), value: item.special_requirements },
    { label: t("工作地点"), value: item.work_location },
    { label: t("备注"), value: item.notes },
  ]

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2 text-lg">
            {t("岗位详情")}{' '}<Badge variant="secondary">{item.year}</Badge>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(90vh-8rem)] px-6">
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
                <div className="text-xs font-medium text-muted-foreground">{t("信息来源")}</div>
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
        <Separator />
        <div className="flex justify-end px-6 pb-6">
          <button
            onClick={onClose}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("关闭")}{' '}</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
