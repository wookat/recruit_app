import { t } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { Loader2, Pencil, Sparkles, X } from 'lucide-react'
import {
  fetchBianzhiMatch,
  fetchCampusMatch,
  type BianzhiJob,
  type BianzhiMatchItem,
  type CampusJob,
  type CampusMatchItem,
  type MatchLevel,
  type MatchOut,
  type MatchReasons,
} from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { profileUsable, saveProfile, useProfile, type UserProfile } from '@/lib/profile'
import majorSlugs from '@/data/majorSlugs.json'

const MAJOR_SLUGS = majorSlugs as Record<string, string>

const EDU_LEVELS = ['大专/中专', '本科', '硕士研究生', '博士研究生']
const CAMPUS_UNIT_TYPES = ['央国企', '民企', '外企', '事业单位']
const BIANZHI_UNIT_TYPES = ['公务员、事业单位', '教育系统', '医疗系统', '高校高职大专', '科研院所', '央国企社招']
const GRAD_YEARS = ['2025届', '2026届', '2027届']

interface Props {
  board: 'campus' | 'bianzhi'
  onOpenDetail?: (job: CampusJob | BianzhiJob) => void
}

function levelBadge(label: string, level: MatchLevel | 'ok' | 'unset') {
  if (level === 'unset') return null
  const style =
    level === 'exact' || level === 'ok'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : level === 'semantic'
        ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400'
        : level === 'unlimited'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'border-border bg-muted/40 text-muted-foreground'
  const suffix =
    level === 'exact' || level === 'ok'
      ? '✓'
      : level === 'semantic'
        ? t("≈同类")
        : level === 'unlimited'
          ? t("不限")
          : '✗'
  return (
    <span key={label} className={cn('rounded-md border px-1.5 py-0.5 text-[11px] leading-none', style)}>
      {label}
      {suffix}
    </span>
  )
}

function ReasonBadges({ r, board }: { r: MatchReasons; board: 'campus' | 'bianzhi' }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {levelBadge(t("专业"), r.major)}
      {levelBadge(t("学历"), r.edu)}
      {levelBadge(t("地点"), r.location)}
      {board === 'campus' && levelBadge(t("届次"), r.grad_year)}
      {levelBadge(t("单位"), r.unit_type)}
    </span>
  )
}

/** 校招/编制板块的「按我的条件匹配」：多维画像 + AI 语义匹配结果面板。 */
export function MatchByProfileButton({ board, onOpenDetail }: Props) {
  const profile = useProfile()
  const [editing, setEditing] = useState(false)
  const [active, setActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [result, setResult] = useState<MatchOut<CampusMatchItem | BianzhiMatchItem> | null>(null)
  const [showCount, setShowCount] = useState(10)
  const [reasonTerm, setReasonTerm] = useState<string | null>(null)

  const [eduLevel, setEduLevel] = useState<string[]>(profile.eduLevel)
  const [majorsText, setMajorsText] = useState(profile.majors.join('、'))
  const [locationText, setLocationText] = useState(profile.location.join('、'))
  const [gradYear, setGradYear] = useState(profile.gradYear)
  const [unitTypes, setUnitTypes] = useState<string[]>(profile.unitTypes)

  const unitOptions = board === 'campus' ? CAMPUS_UNIT_TYPES : BIANZHI_UNIT_TYPES

  const parseList = (text: string) =>
    text
      .split(/[、，,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10)

  const syncEditor = (p: UserProfile) => {
    setEduLevel(p.eduLevel)
    setMajorsText(p.majors.join('、'))
    setLocationText(p.location.join('、'))
    setGradYear(p.gradYear)
    setUnitTypes(p.unitTypes)
  }

  const runMatch = (p: UserProfile) => {
    setActive(true)
    setLoading(true)
    setError(false)
    setResult(null)
    setShowCount(10)
    setReasonTerm(null)
    const body = {
      edu_level: p.eduLevel,
      majors: p.majors,
      locations: p.location,
      grad_year: board === 'campus' ? p.gradYear : '',
      unit_types: p.unitTypes.filter((u) => unitOptions.includes(u)),
    }
    const req = board === 'campus' ? fetchCampusMatch(body) : fetchBianzhiMatch(body)
    req
      .then((r) => setResult(r))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    // 板块切换时结果不复用
    setActive(false)
    setResult(null)
  }, [board])

  const saveAndApply = () => {
    const majors = parseList(majorsText).slice(0, 5)
    const p: UserProfile = {
      eduLevel,
      major: majors[0] ?? '',
      majors,
      location: parseList(locationText),
      gradYear,
      unitTypes,
    }
    if (!profileUsable(p)) return
    saveProfile(p)
    setEditing(false)
    runMatch(p)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={active ? 'default' : 'outline'}
          size="sm"
          className="min-h-11 gap-1.5 sm:min-h-8"
          onClick={() => {
            if (active) return
            if (profileUsable(profile)) {
              syncEditor(profile)
              runMatch(profile)
            } else {
              setEditing(true)
            }
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t("智能匹配")}{' '}</Button>
        <span className="text-xs text-muted-foreground">
          {t("按学历+专业(AI 语义)+地点")}{board === 'campus' ? t("+届次") : ''}{t("+单位类型逐维打分")}{' '}</span>
        {profileUsable(profile) && !editing && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1 text-xs text-muted-foreground sm:min-h-8"
            onClick={() => {
              syncEditor(profile)
              setEditing(true)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            {t("修改条件")}{' '}</Button>
        )}
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1 text-xs text-muted-foreground sm:min-h-8"
            onClick={() => {
              setActive(false)
              setResult(null)
            }}
          >
            <X className="h-3.5 w-3.5" />
            {t("收起匹配")}{' '}</Button>
        )}
      </div>

      {editing && (
        <div className="space-y-3 rounded-xl border border-primary/15 bg-gradient-to-br from-primary/[0.03] to-muted/30 p-3 sm:p-4">
          <p className="text-xs text-muted-foreground">
            {t("填写你的画像（全站共用一份，填一次三板块可用）；专业支持多个，AI 会自动扩展同大类相关专业")}{' '}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("学历")}</label>
              <div className="flex flex-wrap gap-1.5">
                {EDU_LEVELS.map((e) => (
                  <Badge
                    key={e}
                    variant={eduLevel.includes(e) ? 'default' : 'outline'}
                    className="cursor-pointer text-xs"
                    onClick={() =>
                      setEduLevel((prev) =>
                        prev.includes(e) ? prev.filter((v) => v !== e) : [...prev, e],
                      )
                    }
                  >
                    {t(e)}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("专业（可多个，顿号分隔）")}</label>
              <Input
                placeholder={t("如：计算机科学与技术、软件工程")}
                value={majorsText}
                onChange={(e) => setMajorsText(e.target.value)}
                className="h-9"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveAndApply()
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("意向城市/省份（可多个）")}</label>
              <Input
                placeholder={t("如：山东、济南")}
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                className="h-9"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveAndApply()
                }}
              />
            </div>
            {board === 'campus' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("应届年份")}</label>
                <div className="flex flex-wrap gap-1.5">
                  {GRAD_YEARS.map((y) => (
                    <Badge
                      key={y}
                      variant={gradYear === y ? 'default' : 'outline'}
                      className="cursor-pointer text-xs"
                      onClick={() => setGradYear((prev) => (prev === y ? '' : y))}
                    >
                      {y}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">{t("意向单位类型（可多选）")}</label>
              <div className="flex flex-wrap gap-1.5">
                {unitOptions.map((u) => (
                  <Badge
                    key={u}
                    variant={unitTypes.includes(u) ? 'default' : 'outline'}
                    className="cursor-pointer text-xs"
                    onClick={() =>
                      setUnitTypes((prev) =>
                        prev.includes(u) ? prev.filter((v) => v !== u) : [...prev, u],
                      )
                    }
                  >
                    {t(u)}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="min-h-11 sm:min-h-8"
              onClick={saveAndApply}
              disabled={!parseList(majorsText).length && !parseList(locationText).length}
            >
              {t("保存并匹配")}{' '}</Button>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 sm:min-h-8"
              onClick={() => setEditing(false)}
            >
              {t("取消")}{' '}</Button>
          </div>
        </div>
      )}

      {active && (
        <div className="space-y-2 rounded-xl border border-primary/15 bg-gradient-to-br from-primary/[0.03] to-muted/30 p-3 sm:p-4">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("AI 正在按你的画像匹配岗位…")}{' '}</p>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {t("匹配失败，请稍后重试")}{' '}</p>
          )}
          {result && (
            <>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t("匹配结果")}{' '}{result.items.length} {' '}{t("条（按匹配度排序）")}{' '}</span>
                {result.categories.length > 0 && <span>{t("专业大类：")}{result.categories.join('、')}</span>}
                {profile.majors
                  .filter((m) => MAJOR_SLUGS[m])
                  .slice(0, 2)
                  .map((m) => (
                    <a
                      key={m}
                      href={`/major/${MAJOR_SLUGS[m]}`}
                      className="text-primary underline underline-offset-2"
                    >
                      {t("查看")}{m}{t("专业可报岗位 →")}
                    </a>
                  ))}
              </div>
              {result.expanded_terms.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <span>{result.semantic_source === 'ai' ? t("AI 扩展") : t("同类扩展")}：</span>
                  {result.expanded_terms.slice(0, 12).map((term) => {
                    const reason = result.term_reasons?.[term]
                    return (
                      <button
                        key={term}
                        type="button"
                        title={reason}
                        aria-expanded={reason ? reasonTerm === term : undefined}
                        onClick={() => reason && setReasonTerm((prev) => (prev === term ? null : term))}
                        className={cn(
                          'rounded-md border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 leading-none text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 dark:text-sky-400',
                          reason ? 'cursor-pointer hover:bg-sky-500/20' : 'cursor-default',
                          reasonTerm === term && 'ring-1 ring-sky-500/60',
                        )}
                      >
                        {term}
                      </button>
                    )
                  })}
                  {result.expanded_terms.length > 12 && <span>…</span>}
                  {result.term_reasons && Object.keys(result.term_reasons).length > 0 && (
                    <span className="text-[11px]">{t("（点击查看扩展理由）")}</span>
                  )}
                </div>
              )}
              {reasonTerm && result.term_reasons?.[reasonTerm] && (
                <p className="rounded-md border border-sky-500/20 bg-sky-500/5 px-2 py-1 text-xs text-muted-foreground">
                  <span className="font-medium text-sky-700 dark:text-sky-400">{reasonTerm}</span>
                  ：{result.term_reasons[reasonTerm]}
                </p>
              )}
              {result.items.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("没有匹配到岗位，试试放宽画像条件")}</p>
              )}
              <ul className="divide-y divide-border/60">
                {result.items.slice(0, showCount).map((it) => {
                  const job = it.job
                  const title =
                    'company' in job ? job.company : (job as BianzhiJob).employer
                  const sub =
                    'company' in job
                      ? [job.positions, job.locations].filter(Boolean).join(' · ')
                      : [
                          (job as BianzhiJob).job_type,
                          (job as BianzhiJob).province,
                          (job as BianzhiJob).work_location,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                  const pct = Math.max(5, Math.min(100, Math.round((it.score / 70) * 100)))
                  return (
                    <li key={job.id}>
                      <button
                        type="button"
                        className="flex w-full flex-col gap-1 rounded-md px-1 py-2 text-left hover:bg-muted/40"
                        onClick={() => onOpenDetail?.(job)}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <span
                                className="block h-full rounded-full bg-primary"
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                            <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
                          </span>
                        </span>
                        {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
                        <ReasonBadges r={it.reasons} board={board} />
                      </button>
                    </li>
                  )
                })}
              </ul>
              {result.items.length > showCount && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  onClick={() => setShowCount((n) => n + 10)}
                >
                  {t("展开更多（还有")}{' '}{result.items.length - showCount} {' '}{t("条）")}{' '}</Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
