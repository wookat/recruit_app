import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Building2, CalendarClock, ChevronLeft, ChevronRight, Filter, GraduationCap, Info, Link2, Sparkles, TimerOff } from 'lucide-react'
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
import { ShareMenuButton, ShareTextButton } from '@/components/ShareTextButton'
import { ShareLandingBanner } from '@/components/ShareLandingBanner'
import { ReportIssueButton } from '@/components/ReportIssueButton'
import { jobShareUrl } from '@/lib/clipboard'
import { clearJobParam, setJobParam } from '@/lib/jobDeepLink'
import { addViewHistory } from '@/lib/viewHistory'
import { PrepResources } from '@/components/PrepResources'
import { ExtLinkAnchor } from '@/components/ExtLinkAnchor'
import { SheetDragHandle } from '@/components/SheetDragHandle'
import { ApplyTimeline } from '@/components/ApplyTimeline'
import { fetchLinkStatus } from '@/api'

export interface SheetField {
  label: string
  value: string | null | undefined
}

export interface SheetLink {
  label: string
  url: string | null | undefined
  primary?: boolean
  /** 传入时查询死链扫描结果，已失效链接显示提示。 */
  checkDead?: boolean
}

export interface SheetTag {
  key: string
  label: string
  /** 传入时标签可点，写入对应筛选并关闭面板。 */
  onClick?: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  title: string
  badges?: string[]
  /** 从字段派生的岗位标签；带 onClick 的可点写入筛选。 */
  tags?: SheetTag[]
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
  /** 岗位报名已截止时显示提示条。 */
  expiredNotice?: boolean
  /** 相关条目区块（如同单位其他公告），点击切换详情。 */
  related?: {
    title: string
    items: { key: string; label: string; sub?: string | null }[]
    onSelect: (key: string) => void
  }
  /** 相似岗位区块（同分类/同行业推荐），点击切换详情。 */
  similar?: {
    title: string
    items: { key: string; label: string; sub?: string | null }[]
    onSelect: (key: string) => void
  }
  /** 网申窗口（开始/截止日期都可解析时传入），展示时间线进度条。 */
  applyWindow?: { start: Date; end: Date } | null
  /** 传入时展示「备考资源」区块（攻略锚点 + 省人社官网 + 日历提醒）。 */
  prep?: {
    examType: string | null | undefined
    province: string | null | undefined
    deadline: Date | null
    icsUid: string
    icsSummary: string
  }
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
  tags,
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
  expiredNotice,
  related,
  similar,
  applyWindow,
  prep,
}: Props) {
  const validLinks = (links ?? []).filter((l) => safeUrl(l.url))
  const [deadUrls, setDeadUrls] = useState<Record<string, boolean>>({})
  const queriedUrls = useRef(new Set<string>())

  useEffect(() => {
    if (!open) return
    let cancelled = false
    for (const l of validLinks) {
      const u = l.url
      if (!l.checkDead || !u || queriedUrls.current.has(u)) continue
      queriedUrls.current.add(u)
      fetchLinkStatus(u)
        .then((s) => {
          if (!cancelled && s.checked && s.ok === false) {
            setDeadUrls((m) => ({ ...m, [u]: true }))
          }
        })
        .catch(() => queriedUrls.current.delete(u))
    }
    return () => {
      cancelled = true
    }
  }, [open, validLinks])

  useEffect(() => {
    if (!open || !jobKey) return
    setJobParam(jobKey)
    return () => clearJobParam(jobKey)
  }, [open, jobKey])

  useEffect(() => {
    if (!open || !jobKey) return
    const [board, idStr] = jobKey.split(':')
    const id = Number(idStr)
    if ((board === 'campus' || board === 'bianzhi') && id > 0) {
      addViewHistory(board, id, title)
    }
  }, [open, jobKey, title])

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
        <SheetDragHandle onDismiss={onClose} />
        <SheetHeader className="space-y-2 px-4 pt-1 sm:px-6 sm:pt-6">
          {jobKey && <ShareLandingBanner key={jobKey} jobKey={jobKey} onBrowseAll={onClose} />}
          {expiredNotice && (
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-foreground/80 dark:text-muted-foreground">
              <TimerOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              该岗位报名已截止，信息仅供参考{similar && similar.items.length > 0 ? '；可查看下方相似岗位' : ''}
            </div>
          )}
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-8 text-lg">
            <span className="break-all">{title}</span>
            {(badges ?? []).filter(Boolean).map((b) => (
              <Badge key={b} variant="secondary">
                {b}
              </Badge>
            ))}
          </SheetTitle>
          {(tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(tags ?? []).map((t) =>
                t.onClick ? (
                  <button
                    key={t.key}
                    type="button"
                    className="cursor-pointer"
                    title="点击按此标签筛选"
                    aria-label={`按「${t.label}」筛选`}
                    onClick={t.onClick}
                  >
                    <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary transition-colors hover:bg-primary/20">
                      <Filter className="h-3 w-3" aria-hidden="true" />
                      {t.label}
                    </Badge>
                  </button>
                ) : (
                  <Badge key={t.key} variant="secondary" className="font-normal">
                    {t.label}
                  </Badge>
                ),
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <BoardFavoriteButton active={favActive} onToggle={onFavToggle} />
            {(() => {
              const [b, idStr] = (jobKey || '').split(':')
              const id = Number(idStr)
              return (b === 'campus' || b === 'bianzhi') && id > 0 ? (
                <>
                  <ShareMenuButton text={shareText} url={jobShareUrl(b, id)} title={title} />
                  <ReportIssueButton board={b} itemId={id} />
                </>
              ) : (
                <ShareTextButton text={shareText} />
              )
            })()}
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
            {applyWindow && <ApplyTimeline start={applyWindow.start} end={applyWindow.end} />}

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
                        <ExtLinkAnchor url={safeUrl(l.url)!} />
                        {l.url && deadUrls[l.url] && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                            检测到该链接可能已失效，建议前往公司官方招聘渠道核实
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            {related && related.items.length > 0 && (
              <>
                <Separator />
                <section className="space-y-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <Building2 className="h-4 w-4 text-primary" />
                    {related.title}
                  </div>
                  <ul className="space-y-1 pl-0.5">
                    {related.items.map((it) => (
                      <li key={it.key}>
                        <button
                          type="button"
                          className="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-x-2 rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                          onClick={() => related.onSelect(it.key)}
                        >
                          <span className="font-medium">{it.label}</span>
                          {it.sub && (
                            <span className="line-clamp-1 text-xs text-muted-foreground">{it.sub}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}

            {similar && similar.items.length > 0 && (
              <>
                <Separator />
                <section className="space-y-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <Sparkles className="h-4 w-4 text-primary" />
                    {similar.title}
                  </div>
                  <ul className="space-y-1 pl-0.5">
                    {similar.items.map((it) => (
                      <li key={it.key}>
                        <button
                          type="button"
                          className="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-x-2 rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                          onClick={() => similar.onSelect(it.key)}
                        >
                          <span className="font-medium">{it.label}</span>
                          {it.sub && (
                            <span className="line-clamp-1 text-xs text-muted-foreground">{it.sub}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}

            {prep && (
              <>
                <Separator />
                <PrepResources {...prep} />
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
