import type { Position } from '@/api'
import { ExternalLink, GraduationCap, CalendarClock, Info, AlertTriangle, MapPin } from 'lucide-react'
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

function parseMajors(raw: string): string[] {
  if (!raw) return []
  return raw
    .split(/[、，,;；/｜|]+/)
    .map((s) => s.replace(/(等相关专业|等专业|相关专业|等)$/g, '').trim())
    .filter((s) => s.length > 0 && s.length <= 30)
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  if (!value) return null
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{String(value)}</div>
    </div>
  )
}

function MajorField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  const majors = parseMajors(value)
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {majors.length > 1 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {majors.map((m, i) => (
            <Badge key={`${m}-${i}`} variant="secondary" className="font-normal">
              {m}
            </Badge>
          ))}
        </div>
      ) : (
        <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{value}</div>
      )}
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Info
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </div>
      <div className="space-y-3 pl-0.5">{children}</div>
    </section>
  )
}

export function PositionSheet({ item, onClose }: Props) {
  if (!item) return null

  const hasRequirements =
    item.edu_level_norm || item.edu_requirement || item.undergrad_major || item.grad_major || item.raw_major
  const hasSchedule = item.signup_time || item.exam_time || item.exam_form

  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-2xl p-0 sm:max-w-xl">
        <SheetHeader className="px-4 pt-6 sm:px-6">
          <SheetTitle className="flex flex-wrap items-center gap-2 text-lg">
            岗位详情
            <Badge variant="secondary">{item.year}</Badge>
            {item.job_type && <Badge variant="outline">{item.job_type}</Badge>}
            {item.edu_level_norm && <Badge variant="outline">{item.edu_level_norm}</Badge>}
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100dvh-5rem)] px-4 sm:px-6">
          <div className="space-y-5 pb-8 pt-2">
            <Section icon={Info} title="基本信息">
              <Field label="用人单位/系统" value={item.employer} />
              <Field label="岗位示例" value={item.position_example} />
              <Field label="考试/招聘类型" value={item.exam_type} />
              <div className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-xs font-medium text-muted-foreground">工作地点</div>
                  <div className="mt-0.5 text-sm">{item.work_location || '-'}</div>
                </div>
              </div>
            </Section>

            {hasRequirements && (
              <>
                <Separator />
                <Section icon={GraduationCap} title="报考条件">
                  <Field label="学历要求" value={item.edu_level_norm || item.edu_requirement} />
                  {item.edu_level_norm && item.edu_requirement && item.edu_requirement !== item.edu_level_norm && (
                    <Field label="学历要求（原始）" value={item.edu_requirement} />
                  )}
                  <MajorField label="本科生专业要求" value={item.undergrad_major} />
                  <MajorField label="研究生专业要求" value={item.grad_major} />
                  {!item.undergrad_major && !item.grad_major && (
                    <MajorField label="专业要求" value={item.raw_major} />
                  )}
                </Section>
              </>
            )}

            {item.special_requirements && (
              <>
                <Separator />
                <Section icon={AlertTriangle} title="特殊要求">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                    {item.special_requirements}
                  </div>
                </Section>
              </>
            )}

            {hasSchedule && (
              <>
                <Separator />
                <Section icon={CalendarClock} title="时间安排">
                  <Field label="报名时间" value={item.signup_time} />
                  <Field label="笔试/考试时间" value={item.exam_time} />
                  <Field label="考试/招聘形式" value={item.exam_form} />
                </Section>
              </>
            )}

            {(item.notes || item.source_url) && (
              <>
                <Separator />
                <Section icon={Info} title="备注与来源">
                  <Field label="备注" value={item.notes} />
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
                        <ExternalLink className="ml-1 h-3 w-3 shrink-0" />
                      </a>
                    </div>
                  )}
                </Section>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
