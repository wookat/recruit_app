import { useEffect } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, ExternalLink, GraduationCap, Info, Link2 } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { BoardFavoriteButton } from '@/components/BoardFavoriteButton'
import { ShareTextButton } from '@/components/ShareTextButton'
import { clearJobParam, setJobParam } from '@/lib/jobDeepLink'

export interface SheetField {
  label: string
  value: string | null | undefined
}

export interface SheetLink {
  label: string
  url: string | null | undefined
  primary?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  title: string
  badges?: string[]
  shareText: string
  favActive: boolean
  onFavToggle: () => void
  basics: SheetField[]
  requirements?: SheetField[]
  schedule?: SheetField[]
  links?: SheetLink[]
  /** 深链 key（如 campus:123）；传入时打开写入 URL、关闭清除。 */
  jobKey?: string
  onPrev?: () => void
  onNext?: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
  /** 收藏面板打开时标注数据为收藏时快照。 */
  snapshotNote?: boolean
}

function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null
  try {
    const p = new URL(u).protocol
    return p === 'http:' || p === 'https:' ? u : null
  } catch {
    return null
  }
}

function Field({ label, value }: SheetField) {
  if (!value || value.trim() === '/' || value.trim() === '') return null
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{value}</div>
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  fields,
}: {
  icon: typeof Info
  title: string
  fields: SheetField[]
}) {
  if (!fields.some((f) => f.value && f.value.trim() && f.value.trim() !== '/')) return null
  return (
    <>
      <Separator />
      <section className="space-y-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </div>
        <div className="space-y-3 pl-0.5">
          {fields.map((f) => (
            <Field key={f.label} {...f} />
          ))}
        </div>
      </section>
    </>
  )
}

/** 校招/编制通用的岗位详情侧滑面板（375px 全屏抽屉）。 */
export function BoardJobSheet({
  open,
  onClose,
  title,
  badges,
  shareText,
  favActive,
  onFavToggle,
  basics,
  requirements,
  schedule,
  links,
  jobKey,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  snapshotNote,
}: Props) {
  const validLinks = (links ?? []).filter((l) => safeUrl(l.url))

  useEffect(() => {
    if (!open || !jobKey) return
    setJobParam(jobKey)
    return () => clearJobParam(jobKey)
  }, [open, jobKey])

  useEffect(() => {
    if (!open || (!onPrev && !onNext)) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && onPrev && !prevDisabled) onPrev()
      else if (e.key === 'ArrowRight' && onNext && !nextDisabled) onNext()
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open, onPrev, onNext, prevDisabled, nextDisabled])
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full max-w-2xl p-0 data-[side=right]:w-full sm:max-w-xl">
        <SheetHeader className="space-y-2 px-4 pt-6 sm:px-6">
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-8 text-lg">
            <span className="break-all">{title}</span>
            {(badges ?? []).filter(Boolean).map((b) => (
              <Badge key={b} variant="secondary">
                {b}
              </Badge>
            ))}
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-1">
            <BoardFavoriteButton active={favActive} onToggle={onFavToggle} />
            <ShareTextButton text={shareText} />
            {(onPrev || onNext) && (
              <span className="ml-auto inline-flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-0.5 px-2 text-xs"
                  disabled={prevDisabled}
                  onClick={onPrev}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  上一条
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-0.5 px-2 text-xs"
                  disabled={nextDisabled}
                  onClick={onNext}
                >
                  下一条
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </span>
            )}
            {snapshotNote && (
              <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
                收藏时快照
              </Badge>
            )}
          </div>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-4 sm:px-6">
          <div className="space-y-5 pb-8 pt-2">
            <section className="space-y-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Info className="h-4 w-4 text-primary" />
                基本信息
              </div>
              <div className="space-y-3 pl-0.5">
                {basics.map((f) => (
                  <Field key={f.label} {...f} />
                ))}
              </div>
            </section>

            {requirements && (
              <Section icon={GraduationCap} title="要求" fields={requirements} />
            )}
            {schedule && <Section icon={CalendarClock} title="时间" fields={schedule} />}

            {validLinks.length > 0 && (
              <>
                <Separator />
                <section className="space-y-3">
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <Link2 className="h-4 w-4 text-primary" />
                    链接
                  </div>
                  <div className="space-y-2 pl-0.5">
                    {validLinks.map((l) => (
                      <div key={l.label}>
                        <div className="text-xs font-medium text-muted-foreground">{l.label}</div>
                        <a
                          href={safeUrl(l.url)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center break-all text-sm text-primary hover:underline"
                        >
                          {l.url}
                          <ExternalLink className="ml-1 h-3 w-3 shrink-0" />
                        </a>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
