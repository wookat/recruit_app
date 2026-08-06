import { t, tt } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { fetchPositions, fetchSimilarPositions, type Position } from '@/api'
import { copyText, jobShareUrl, positionShareUrl } from '@/lib/clipboard'
import { clearJobParam, setJobParam } from '@/lib/jobDeepLink'
import { stripOrgPrefix } from '@/lib/orgPrefix'
import { addViewHistory } from '@/lib/viewHistory'
import { derivePositionTags } from '@/lib/jobTags'
import { daysUntil, parseDeadlineText, parseSignupDeadline } from '@/lib/deadline'
import { PrepResources } from './PrepResources'
import { ExtLinkAnchor } from './ExtLinkAnchor'
import { CompetitionRef } from './CompetitionRef'
import { EmployerHistory } from './EmployerHistory'
import { SheetDragHandle } from './SheetDragHandle'
import { Building2, Filter, GraduationCap, CalendarClock, ChevronLeft, ChevronRight, Info, AlertTriangle, MapPin, Link2, Check, Sparkles, TimerOff } from 'lucide-react'
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
import { FavoriteButton } from './FavoriteButton'
import { RemindMeButton } from './RemindMeButton'
import { CompareButton } from './CompareButton'
import { ShareMenuButton, buildShareText } from './ShareTextButton'
import { ShareLandingBanner } from './ShareLandingBanner'
import { ReportIssueButton } from './ReportIssueButton'
import {
  APP_STATUSES,
  STATUS_COLORS,
  setAppStatus,
  toggleFavorite,
  useAppStatuses,
  useFavorites,
  type AppStatus,
} from '@/lib/positionStore'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'

interface Props {
  item: Position | null
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
  /** 收藏面板打开时标注数据为收藏时快照。 */
  snapshotNote?: boolean
  /** 传入时展示「同单位其他岗位」「相似岗位」区块，点击切换详情。 */
  onOpenItem?: (p: Position) => void
  /** 传入时可点标签写入对应筛选（如「本科可报」→学历筛选）。 */
  onTagClick?: (tagKey: string) => void
}

function parseMajors(raw: string): string[] {
  if (!raw) return []
  return raw
    .split(/[、，,;；/｜|]+/)
    .map((s) => s.replace(/(等相关专业|等专业|相关专业|等)$/g, '').trim())
    .filter((s) => s.length > 0 && s.length <= 30)
}

function Field({
  label,
  value,
  linkify,
}: {
  label: string
  value?: string | number | null
  /** 识别文本中的 http(s) 链接并渲染为可点击链接。 */
  linkify?: boolean
}) {
  if (!value) return null
  const text = String(value)
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
        {linkify
          ? text.split(/(https?:\/\/[^\s，。；]+)/g).map((part, i) =>
              /^https?:\/\//.test(part) ? (
                <a
                  key={i}
                  href={part}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-primary hover:underline"
                >
                  {part}
                </a>
              ) : (
                part
              ),
            )
          : text}
      </div>
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

function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null
  try {
    const p = new URL(u).protocol
    return p === 'http:' || p === 'https:' ? u : null
  } catch {
    return null
  }
}

export function PositionSheet({
  item,
  onClose,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  snapshotNote,
  onOpenItem,
  onTagClick,
}: Props) {
  const [copied, setCopied] = useState(false)
  const statuses = useAppStatuses()
  const favorites = useFavorites()
  const [related, setRelated] = useState<Position[]>([])
  const [similar, setSimilar] = useState<Position[]>([])
  const itemId = item?.id
  const employer = item?.employer?.trim()

  useEffect(() => {
    if (!item) return
    const t =
      item.employer?.trim() ||
      stripOrgPrefix(item.position_example ?? '', item.employer, item.exam_type_norm || item.exam_type) ||
      item.exam_type ||
      item.job_type ||
      '体制内岗位'
    addViewHistory('positions', item.id, t)
  }, [item])

  useEffect(() => {
    if (!employer || !onOpenItem) {
      setRelated([])
      return
    }
    let cancelled = false
    fetchPositions({ keyword: employer, page: 1, page_size: 20 })
      .then((res) => {
        if (cancelled) return
        setRelated(
          res.items
            .filter((p) => p.id !== itemId && (p.employer ?? '').trim() === employer)
            .slice(0, 5),
        )
      })
      .catch(() => {
        if (!cancelled) setRelated([])
      })
    return () => {
      cancelled = true
    }
  }, [employer, itemId, onOpenItem])

  useEffect(() => {
    if (!itemId || !onOpenItem) {
      setSimilar([])
      return
    }
    let cancelled = false
    fetchSimilarPositions(itemId)
      .then((res) => {
        if (!cancelled) setSimilar(res)
      })
      .catch(() => {
        if (!cancelled) setSimilar([])
      })
    return () => {
      cancelled = true
    }
  }, [itemId, onOpenItem])

  useEffect(() => {
    if (!itemId) return
    const key = `positions:${itemId}`
    setJobParam(key)
    return () => clearJobParam(key)
  }, [itemId])

  useEffect(() => {
    if (!itemId || (!onPrev && !onNext)) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && onPrev && !prevDisabled) onPrev()
      else if (e.key === 'ArrowRight' && onNext && !nextDisabled) onNext()
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [itemId, onPrev, onNext, prevDisabled, nextDisabled])

  if (!item) return null

  async function copyLink() {
    if (!item) return
    await copyText(positionShareUrl(item.id))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasRequirements =
    item.edu_level_norm || item.edu_requirement || item.undergrad_major || item.grad_major || item.raw_major
  const hasSchedule = item.signup_time || item.exam_time || item.exam_form

  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-2xl p-0 data-[side=right]:w-full sm:max-w-xl">
        <SheetDragHandle onDismiss={onClose} />
        <SheetHeader className="space-y-2 px-4 pt-1 sm:px-6 sm:pt-6">
          <ShareLandingBanner key={item.id} jobKey={`positions:${item.id}`} onBrowseAll={onClose} />
          {(() => {
            const d = parseSignupDeadline(item)
            return d && daysUntil(d) < 0 ? (
              <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-foreground/80 dark:text-muted-foreground">
                <TimerOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("该岗位报名已截止，信息仅供参考；可查看下方相似岗位")}{' '}</div>
            ) : null
          })()}
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-8 text-lg">
            {t("岗位详情")}{' '}<Badge variant="secondary">{item.year}</Badge>
            {item.job_type && <Badge variant="outline">{item.job_type}</Badge>}
            {item.edu_level_norm &&
              (onTagClick && item.edu_level_norm === '本科' ? (
                <button
                  type="button"
                  className="cursor-pointer"
                  title={t("点击按此学历筛选")}
                  aria-label={tt`按学历「${item.edu_level_norm}」筛选`}
                  onClick={() => onTagClick('edu_bk')}
                >
                  <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary transition-colors hover:bg-primary/20">
                    <Filter className="h-3 w-3" aria-hidden="true" />
                    {item.edu_level_norm}
                  </Badge>
                </button>
              ) : (
                <Badge variant="outline">{item.edu_level_norm}</Badge>
              ))}
          </SheetTitle>
          {derivePositionTags(item).filter((t) => t.key !== 'edu_bk').length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {derivePositionTags(item)
                .filter((t) => t.key !== 'edu_bk')
                .map((t) => (
                  <Badge key={t.key} variant="secondary" className="font-normal">
                    {t.label}
                  </Badge>
                ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t("复制岗位链接")}
              title={t("复制岗位链接")}
              onClick={copyLink}
            >
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Link2 className="h-4 w-4" />}
            </Button>
            <Select
              value={statuses[item.id] || '未投递'}
              onValueChange={(v) => setAppStatus(item.id, v as AppStatus)}
            >
              <SelectTrigger
                size="sm"
                aria-label={t("投递状态")}
                className={`h-7 w-auto gap-1 border-none px-2 text-[11px] font-medium shadow-none ${STATUS_COLORS[(statuses[item.id] || '未投递') as AppStatus]}`}
              >
                {t(statuses[item.id] || '未投递')}
              </SelectTrigger>
              <SelectContent>
                {APP_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {t(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ShareMenuButton
              className="h-11 w-11 sm:h-8 sm:w-8"
              url={jobShareUrl('positions', item.id)}
              title={`${item.position_example || item.exam_type || ''} - ${item.employer || ''}`}
              text={buildShareText({
                org: item.employer,
                title: item.position_example,
                location: item.work_location,
                deadline: item.signup_time,
                deepLink: jobShareUrl('positions', item.id),
                url: item.source_url,
              })}
            />
            <FavoriteButton item={item} />
            <RemindMeButton
              deadline={parseSignupDeadline(item)}
              favActive={favorites.some((p) => p.id === item.id)}
              onFavToggle={() => toggleFavorite(item)}
              jobKey={`positions:${item.id}`}
              jobTitle={item.employer?.trim() || item.position_example?.trim() || item.job_type || ''}
            />
            <CompareButton item={item} />
            <ReportIssueButton board="positions" itemId={item.id} />
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
                  {t("上一条")}{' '}</Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-0.5 px-2 text-xs"
                  disabled={nextDisabled}
                  onClick={onNext}
                >
                  {t("下一条")}{' '}<ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </span>
            )}
            {snapshotNote && (
              <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
                {t("收藏时快照")}{' '}</Badge>
            )}
          </div>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-4 sm:px-6">
          <div className="space-y-5 pb-8 pt-2">
            <Section icon={Info} title={t("基本信息")}>
              <Field label={t("用人单位/系统")} value={item.employer?.trim() || '—'} />
              <Field
                label={t("岗位示例")}
                value={
                  item.position_example
                    ? stripOrgPrefix(item.position_example, item.employer, item.exam_type_norm || item.exam_type)
                    : item.position_example
                }
              />
              <Field label={t("考试/招聘类型")} value={item.exam_type_norm || item.exam_type} />
              <CompetitionRef
                province={item.province}
                examType={item.exam_type_norm}
                year={item.year}
              />
              <EmployerHistory employer={item.employer} currentYear={item.year} />
              <div className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-xs font-medium text-muted-foreground">{t("工作地点")}</div>
                  <div className="mt-0.5 text-sm">{item.work_location || '-'}</div>
                </div>
              </div>
            </Section>

            {hasRequirements && (
              <>
                <Separator />
                <Section icon={GraduationCap} title={t("报考条件")}>
                  <Field label={t("学历要求")} value={item.edu_level_norm || item.edu_requirement} />
                  {item.edu_level_norm && item.edu_requirement && item.edu_requirement !== item.edu_level_norm && (
                    <Field label={t("学历要求（原始）")} value={item.edu_requirement} />
                  )}
                  <MajorField label={t("本科生专业要求")} value={item.undergrad_major} />
                  <MajorField label={t("研究生专业要求")} value={item.grad_major} />
                  {!item.undergrad_major && !item.grad_major && (
                    <MajorField label={t("专业要求")} value={item.raw_major} />
                  )}
                </Section>
              </>
            )}

            {item.special_requirements && (
              <>
                <Separator />
                <Section icon={AlertTriangle} title={t("特殊要求")}>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                    {item.special_requirements}
                  </div>
                </Section>
              </>
            )}

            {hasSchedule && (
              <>
                <Separator />
                <Section icon={CalendarClock} title={t("时间安排")}>
                  <Field label={t("报名时间")} value={item.signup_time} />
                  <Field label={t("笔试/考试时间")} value={item.exam_time} />
                  <Field label={t("考试/招聘形式")} value={item.exam_form} />
                </Section>
              </>
            )}

            {(item.notes || item.source_url) && (
              <>
                <Separator />
                <Section icon={Info} title={t("备注与来源")}>
                  <Field label={t("备注")} value={item.notes} linkify />
                  {safeUrl(item.source_url) && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">{t("信息来源")}</div>
                      <ExtLinkAnchor
                        url={safeUrl(item.source_url)!}
                        jobKey={`positions:${item.id}`}
                        jobTitle={item.employer?.trim() || item.position_example?.trim() || ''}
                      />
                      {!item.signup_time?.trim() && !item.exam_time?.trim() && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t("来源页未提供报名/考试时间，请打开信息来源原文核实。")}{' '}</div>
                      )}
                    </div>
                  )}
                </Section>
              </>
            )}

            {onOpenItem && related.length > 0 && (
              <>
                <Separator />
                <Section icon={Building2} title={t("同单位其他岗位")}>
                  <ul className="space-y-1">
                    {related.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-x-2 rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                          onClick={() => onOpenItem(p)}
                        >
                          <span className="font-medium">
                            {p.position_example
                              ? stripOrgPrefix(p.position_example, p.employer, p.exam_type_norm || p.exam_type || p.job_type)
                              : p.job_type || p.exam_type || '-'}
                          </span>
                          <span className="line-clamp-1 text-xs text-muted-foreground">
                            {[p.work_location, p.year ? tt`${p.year} 年` : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              </>
            )}

            {onOpenItem && similar.length > 0 && (
              <>
                <Separator />
                <Section icon={Sparkles} title={t("相似岗位")}>
                  <p className="text-xs text-muted-foreground">
                    {t("同省份 · 同考试类型 · 学历相近")}{' '}</p>
                  <ul className="space-y-1">
                    {similar.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-x-2 rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                          onClick={() => onOpenItem(p)}
                        >
                          <span className="font-medium">
                            {p.employer?.trim() ||
                              (p.position_example
                                ? stripOrgPrefix(p.position_example, p.employer, p.exam_type_norm || p.exam_type || p.job_type)
                                : p.job_type || '-')}
                          </span>
                          <span className="line-clamp-1 text-xs text-muted-foreground">
                            {[
                              p.employer?.trim() && p.position_example
                                ? stripOrgPrefix(p.position_example, p.employer, p.exam_type_norm || p.exam_type)
                                : null,
                              p.work_location,
                              p.edu_level_norm,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              </>
            )}

            <Separator />
            <PrepResources
              examType={item.exam_type || item.job_type}
              province={(item.work_location || '').split(/[-—·，,]/)[0] || null}
              deadline={parseSignupDeadline(item)}
              icsUid={`pos-${item.id}`}
              icsSummary={tt`报名截止：${item.employer?.trim() || stripOrgPrefix(item.position_example ?? '', item.employer, item.exam_type_norm || item.exam_type) || item.job_type || t("岗位")}`}
              examDate={(() => {
                const d = parseDeadlineText(item.exam_time, item.year || undefined)
                const dl = parseSignupDeadline(item)
                return d && (!dl || d.getTime() >= dl.getTime()) ? d : null
              })()}
              examSummary={tt`笔试/考试：${item.employer?.trim() || item.job_type || t("岗位")}`}
            />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
