import { t, tt } from '@/lib/i18n'
import { useRef, useState } from 'react'
import { BookOpen, CalendarPlus, Check, ExternalLink } from 'lucide-react'
import hrSites from '@/data/hrSites.json'
import { downloadIcs } from '@/lib/ics'

/** 站内攻略锚点（JobGuideSheet SECTIONS key）。 */
interface GuideLink {
  key: string
  label: string
}

const GUIDE_LINKS: Record<string, GuideLink> = {
  timeline: { key: 'timeline', label: t("秋招/春招时间线") },
  biancal: { key: 'biancal', label: t("编制考试日历") },
  resume: { key: 'resume', label: t("简历制作") },
  interview: { key: 'interview', label: t("面试攻略") },
  company: { key: 'company', label: t("企业类型特点") },
  choose: { key: 'choose', label: t("编制 vs 校招怎么选") },
  tips: { key: 'tips', label: t("实用技巧") },
}

/** 按考试类型/分类静态映射站内攻略锚点；无匹配走编制默认组合。 */
export function guideLinksFor(examOrCategory: string | null | undefined): GuideLink[] {
  const t = examOrCategory || ''
  const pick = (...keys: string[]) => keys.map((k) => GUIDE_LINKS[k])
  if (/国企|央企/.test(t)) return pick('timeline', 'company', 'resume')
  if (/实习/.test(t)) return pick('timeline', 'resume', 'tips')
  if (/秋招|春招|校招|民企|外企|互联网/.test(t)) return pick('timeline', 'resume', 'interview')
  if (/教师|教育/.test(t)) return pick('biancal', 'resume', 'interview')
  if (/医疗|医院|卫生/.test(t)) return pick('biancal', 'resume', 'interview')
  if (/军队文职/.test(t)) return pick('biancal', 'interview', 'tips')
  return pick('biancal', 'interview', 'choose')
}

/** 省份 → 人社/考试院官方招聘页（data/hrSites.json，31 省数据）。 */
export function hrSiteFor(province: string | null | undefined): { province: string; url: string } | null {
  const p = (province || '').trim()
  if (!p) return null
  return (
    (hrSites as { province: string; url: string }[]).find(
      (s) => s.province === p || p.startsWith(s.province) || s.province.startsWith(p),
    ) ?? null
  )
}

interface Props {
  /** 考试类型/分类，用于攻略锚点映射。 */
  examType: string | null | undefined
  province: string | null | undefined
  /** 报名截止日；有值时显示「加入日历提醒」。 */
  deadline: Date | null
  icsUid: string
  icsSummary: string
  /** 笔试/考试日期；有值时一并写入 .ics。 */
  examDate?: Date | null
  examSummary?: string
}

/** 详情面板「备考资源」区块：站内攻略锚点 + 省人社官网 + 日历提醒。 */
export function PrepResources({ examType, province, deadline, icsUid, icsSummary, examDate, examSummary }: Props) {
  const links = guideLinksFor(examType)
  const [icsDone, setIcsDone] = useState(false)
  const icsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const site = hrSiteFor(province)
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <BookOpen className="h-4 w-4 text-primary" />
        {t("备考资源")}{' '}</div>
      <div className="space-y-2 pl-0.5">
        <div className="flex flex-wrap gap-1.5">
          {links.map((l) => (
            <a
              key={l.key}
              href={`${window.location.origin}${window.location.pathname}#${l.key}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault()
                window.open(
                  `${window.location.origin}${window.location.pathname}#${l.key}`,
                  '_blank',
                  'noopener,noreferrer',
                )
              }}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg border bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted sm:min-h-9"
            >
              {l.label}
            </a>
          ))}
        </div>
        {site && (
          <a
            href={site.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline sm:min-h-0"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {site.province}{t("人社/考试院官方招聘页")}{' '}</a>
        )}
        {deadline && (
          <div>
            <button
              type="button"
              className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-3 text-sm transition-colors hover:bg-muted sm:min-h-9"
              onClick={() => {
                downloadIcs(
                  [
                    { uid: icsUid, date: deadline, summary: icsSummary },
                    ...(examDate
                      ? [{ uid: `${icsUid}-exam`, date: examDate, summary: examSummary || t("笔试/考试") }]
                      : []),
                  ],
                  tt`报名截止提醒_${icsUid}.ics`,
                )
                setIcsDone(true)
                if (icsTimer.current) clearTimeout(icsTimer.current)
                icsTimer.current = setTimeout(() => setIcsDone(false), 2500)
              }}
            >
              {icsDone ? (
                <>
                  <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                  {t("已生成日历文件，打开即可添加提醒")}{' '}</>
              ) : (
                <>
                  <CalendarPlus className="h-4 w-4" />
                  {t("加入日历提醒（")}{deadline.getMonth() + 1}/{deadline.getDate()} {' '}{t("截止")}{' '}{examDate ? tt`，${examDate.getMonth() + 1}/${examDate.getDate()} 考试` : ''}）
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
