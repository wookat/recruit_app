import { t, tt } from '@/lib/i18n'
import { useCallback, useEffect, useState } from 'react'
import {
  adminCheckSource,
  adminListAnnouncements,
  adminListSources,
  adminOverview,
  adminSeedSources,
  adminSetAnnouncementStatus,
  adminUpdateSource,
  fetchCrawlRuns,
  fetchHealthSummary,
  fetchAdminFeedback,
  fetchQualityIssues,
  fetchAdminContent,
  downloadAdminContent,
  triggerContentGenerate,
  fetchSyncStatus,
  setFeedbackHandled,
  fetchSyncToday,
  fetchTaskStatus,
  triggerScrape,
  triggerSyncNow,
  type AdminFeedbackItem,
  type AdminOverview,
  type ContentFileItem,
  type Announcement,
  type CrawlRun,
  type CrawlRunList,
  type HealthSummary,
  type HealthTrendDay,
  type HealthVisitDay,
  type QualityIssues,
  type SyncTodayItem,
  type WatchSource,
} from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Activity, ChevronDown, ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react'

const TOKEN_KEY = 'recruit.adminToken'

export function AdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [input, setInput] = useState('')
  const [authed, setAuthed] = useState(false)
  const [error, setError] = useState('')
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [sources, setSources] = useState<WatchSource[]>([])
  const [anns, setAnns] = useState<Announcement[]>([])
  const [annFilter, setAnnFilter] = useState<string>('new')
  const [busy, setBusy] = useState<number | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskStatus, setTaskStatus] = useState('')
  const [runs, setRuns] = useState<CrawlRunList | null>(null)
  const [health, setHealth] = useState<HealthSummary | null>(null)
  const [healthAt, setHealthAt] = useState<Date | null>(null)
  const [quality, setQuality] = useState<QualityIssues | null>(null)
  const [qualityLoading, setQualityLoading] = useState(false)
  const [runPage, setRunPage] = useState(1)
  const [expandedRun, setExpandedRun] = useState<number | null>(null)

  useEffect(() => {
    if (!taskId || !token) return
    const iv = setInterval(async () => {
      try {
        const res = await fetchTaskStatus(token, taskId)
        setTaskStatus(res.status)
        if (res.status === 'SUCCESS' || res.status === 'FAILURE') clearInterval(iv)
      } catch {
        clearInterval(iv)
      }
    }, 3000)
    return () => clearInterval(iv)
  }, [taskId, token])

  const load = useCallback(
    async (tk: string) => {
      try {
        const [ov, srcs, list] = await Promise.all([
          adminOverview(tk),
          adminListSources(tk),
          adminListAnnouncements(tk, annFilter === 'all' ? undefined : annFilter),
        ])
        setOverview(ov)
        setSources(srcs)
        setAnns(list)
        fetchCrawlRuns(tk, runPage)
          .then((r) => {
            setRuns(r)
            const maxPage = Math.max(1, Math.ceil(r.total / r.page_size))
            if (runPage > maxPage) setRunPage(maxPage)
          })
          .catch(() => setRuns(null))
        fetchHealthSummary(tk)
          .then((h) => {
            setHealth(h)
            setHealthAt(new Date())
          })
          .catch(() => setHealth(null))
        setQualityLoading(true)
        fetchQualityIssues(tk)
          .then(setQuality)
          .catch(() => setQuality(null))
          .finally(() => setQualityLoading(false))
        setAuthed(true)
        setError('')
        localStorage.setItem(TOKEN_KEY, tk)
      } catch {
        setAuthed(false)
        setError(t("令牌无效或后台未配置"))
      }
    },
    [annFilter, runPage],
  )

  useEffect(() => {
    if (token) void load(token)
  }, [token, load])

  useEffect(() => {
    if (!authed || !token) return
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      fetchHealthSummary(token)
        .then((h) => {
          setHealth(h)
          setHealthAt(new Date())
        })
        .catch(() => undefined)
    }
    const iv = window.setInterval(tick, 60000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [authed, token])

  if (!authed) {
    return (
      <div className="mx-auto max-w-sm space-y-4 py-16">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="h-5 w-5" /> {' '}{t("管理后台登录")}{' '}</div>
        <Input
          type="password"
          placeholder={t("输入管理令牌")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setToken(input)}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button className="w-full" onClick={() => setToken(input)} disabled={!input}>
          {t("登录")}{' '}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("管理后台")}</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => load(token)}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> {' '}{t("刷新")}{' '}</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await adminSeedSources(token)
              void load(token)
            }}
          >
            {t("导入默认来源")}{' '}</Button>
        </div>
      </div>

      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t("岗位总量")} value={overview.positions.total} />
          <StatCard label={t("清洗后岗位")} value={overview.positions.clean} />
          <StatCard
            label={t("监控来源")}
            value={overview.watch_sources.enabled}
            sub={tt`共 ${overview.watch_sources.total} · 异常 ${overview.watch_sources.error}`}
          />
          <StatCard
            label={t("待处理公告")}
            value={overview.announcements.new}
            sub={tt`累计 ${overview.announcements.total}`}
          />
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("采集来源")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">{t("名称")}</th>
                <th className="py-2 pr-3">{t("分类")}</th>
                <th className="py-2 pr-3">{t("间隔")}</th>
                <th className="py-2 pr-3">{t("最近检查")}</th>
                <th className="py-2 pr-3">{t("状态")}</th>
                <th className="py-2">{t("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="max-w-[220px] py-2 pr-3">
                    <div className="truncate font-medium">{s.name}</div>
                    <a
                      href={s.index_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block max-w-[220px] truncate text-xs text-muted-foreground hover:underline"
                    >
                      {s.index_url}
                    </a>
                  </td>
                  <td className="py-2 pr-3">{s.category || '-'}</td>
                  <td className="py-2 pr-3">{s.interval_minutes} {' '}{t("分")}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-xs">
                    {s.last_checked_at ? new Date(s.last_checked_at).toLocaleString('zh-CN') : t("未检查")}
                  </td>
                  <td className="py-2 pr-3">
                    {s.last_status === 'error' ? (
                      <Badge variant="destructive" title={s.last_message || ''}>
                        {t("异常")}{' '}</Badge>
                    ) : s.last_status === 'ok' ? (
                      <Badge variant="secondary" title={s.last_message || ''}>
                        {t("正常")}{' '}</Badge>
                    ) : (
                      <Badge variant="outline">{t("待检查")}</Badge>
                    )}
                    {!s.enabled && <Badge variant="outline" className="ml-1">{t("停用")}</Badge>}
                  </td>
                  <td className="whitespace-nowrap py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      disabled={busy === s.id}
                      onClick={async () => {
                        setBusy(s.id)
                        try {
                          await adminCheckSource(token, s.id)
                          await load(token)
                        } finally {
                          setBusy(null)
                        }
                      }}
                    >
                      {busy === s.id ? t("检查中...") : t("立即检查")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={async () => {
                        await adminUpdateSource(token, s.id, {
                          name: s.name,
                          index_url: s.index_url,
                          keywords: s.keywords,
                          category: s.category,
                          year: s.year,
                          enabled: s.enabled ? 0 : 1,
                          interval_minutes: s.interval_minutes,
                        })
                        void load(token)
                      }}
                    >
                      {s.enabled ? t("停用") : t("启用")}
                    </Button>
                  </td>
                </tr>
              ))}
              {sources.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    {t("暂无来源，点击「导入默认来源」初始化")}{' '}</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {health && <HealthCard health={health} updatedAt={healthAt} token={token} />}

      <QualityCard quality={quality} loading={qualityLoading} token={token} />

      <ContentSection token={token} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("抓取任务")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {[2027, 2026, 2025].map((y) => (
            <Button
              key={y}
              size="sm"
              variant="outline"
              disabled={taskStatus === 'PENDING' || taskStatus === 'STARTED'}
              onClick={async () => {
                const res = await triggerScrape(token, y)
                setTaskId(res.task_id)
                setTaskStatus('PENDING')
              }}
            >
              {t("抓取")}{' '}{y} {' '}{t("年")}{' '}</Button>
          ))}
          {taskStatus && (
            <Badge
              variant={
                taskStatus === 'SUCCESS'
                  ? 'secondary'
                  : taskStatus === 'FAILURE'
                    ? 'destructive'
                    : 'outline'
              }
            >
              {taskStatus}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {t("采集调度：每天 6:00 自动检查全部来源")}{' '}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">{t("采集运行历史")}</CardTitle>
          {runs && runs.total > runs.page_size && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={runPage <= 1}
                onClick={() => setRunPage((p) => Math.max(1, p - 1))}
              >
                {t("上一页")}{' '}</Button>
              <span>
                {runs.page}/{Math.max(1, Math.ceil(runs.total / runs.page_size))}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={runs.page >= Math.ceil(runs.total / runs.page_size)}
                onClick={() => setRunPage((p) => p + 1)}
              >
                {t("下一页")}{' '}</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">{t("来源")}</th>
                <th className="py-2 pr-3">{t("开始时间")}</th>
                <th className="py-2 pr-3">{t("耗时")}</th>
                <th className="py-2 pr-3">{t("状态")}</th>
                <th className="py-2 pr-3">{t("公告")}</th>
                <th className="py-2 pr-3">{t("附件")}</th>
                <th className="py-2 pr-3">{t("解析")}</th>
                <th className="py-2">{t("入库")}</th>
              </tr>
            </thead>
            <tbody>
              {(runs?.items || []).map((r) => (
                <RunRow
                  key={r.id}
                  run={r}
                  sourceName={sources.find((s) => s.id === r.source_id)?.name}
                  expanded={expandedRun === r.id}
                  onToggle={() => setExpandedRun((cur) => (cur === r.id ? null : r.id))}
                />
              ))}
              {(!runs || runs.items.length === 0) && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-muted-foreground">
                    {t("暂无采集运行记录")}{' '}</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">{t("公告审核")}</CardTitle>
          <div className="flex gap-1">
            {['new', 'processed', 'ignored', 'all'].map((f) => (
              <Button
                key={f}
                size="sm"
                variant={annFilter === f ? 'default' : 'outline'}
                className="h-7 px-2 text-xs"
                onClick={() => setAnnFilter(f)}
              >
                {{ new: t("待处理"), processed: t("已处理"), ignored: t("已忽略"), all: t("全部") }[f]}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {anns.map((a) => (
            <div
              key={a.id}
              className="flex flex-col gap-1 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {a.title}
                </a>
                <div className="text-xs text-muted-foreground">
                  {a.detected_at ? new Date(a.detected_at).toLocaleString('zh-CN') : ''}
                </div>
              </div>
              {a.status === 'new' && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={async () => {
                      await adminSetAnnouncementStatus(token, a.id, 'processed')
                      void load(token)
                    }}
                  >
                    {t("标记已处理")}{' '}</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={async () => {
                      await adminSetAnnouncementStatus(token, a.id, 'ignored')
                      void load(token)
                    }}
                  >
                    {t("忽略")}{' '}</Button>
                </div>
              )}
            </div>
          ))}
          {anns.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("暂无公告")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const RUN_STATUS_STYLES: Record<string, string> = {
  success: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  partial: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  running: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  alert: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
}

const RUN_STATUS_LABELS: Record<string, string> = {
  success: t("成功"),
  partial: t("部分成功"),
  error: t("失败"),
  running: t("运行中"),
  alert: t("告警"),
}

const HEALTH_BADGE_STYLES: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
}

function formatTtl(seconds: number): string {
  if (seconds <= 0) return t("缺失")
  if (seconds < 3600) return tt`${Math.round(seconds / 60)} 分`
  return tt`${(seconds / 3600).toFixed(1)} 小时`
}

function HealthBadge({ level, label }: { level: 'green' | 'yellow' | 'red'; label: string }) {
  return <Badge className={`border-transparent ${HEALTH_BADGE_STYLES[level]}`}>{label}</Badge>
}

const TABLE_LABELS: Record<string, string> = {
  positions: t("公职岗位"),
  campus_jobs: t("校招岗位"),
  bianzhi_jobs: t("编制岗位"),
}

function formatClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function sampleHref(board: 'positions' | 'campus' | 'bianzhi', id: number): string {
  if (board === 'positions') return `?board=positions&job=positions:${id}`
  if (board === 'campus') return `?board=campus&job=campus:${id}`
  return `?board=bianzhi&bpreset=all&job=bianzhi:${id}`
}

const ISSUE_TYPE_LABELS: Record<string, string> = {
  link_broken: t("链接失效"),
  wrong_info: t("信息错误"),
  expired: t("已过期"),
  other: t("其他"),
}

const BOARD_LABELS: Record<string, string> = {
  positions: t("体制内"),
  campus: t("校招"),
  bianzhi: t("编制"),
}

function ContentSection({ token }: { token: string }) {
  const [items, setItems] = useState<ContentFileItem[]>([])
  const [genTaskId, setGenTaskId] = useState<string | null>(null)
  const [genStatus, setGenStatus] = useState('')

  const loadContent = useCallback(() => {
    fetchAdminContent(token)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]))
  }, [token])

  useEffect(() => {
    loadContent()
  }, [loadContent])

  useEffect(() => {
    if (!genTaskId) return
    const iv = setInterval(async () => {
      try {
        const res = await fetchSyncStatus(token, genTaskId)
        setGenStatus(res.state)
        if (res.state === 'SUCCESS' || res.state === 'FAILURE') {
          clearInterval(iv)
          setGenTaskId(null)
          loadContent()
        }
      } catch {
        clearInterval(iv)
        setGenTaskId(null)
      }
    }, 3000)
    return () => clearInterval(iv)
  }, [genTaskId, token, loadContent])

  const weeks = [...new Set(items.map((it) => it.week))]
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">{t("盘点内容（周更发布素材）")}</CardTitle>
        <Button
          size="sm"
          variant="outline"
          disabled={!!genTaskId}
          onClick={async () => {
            const r = await triggerContentGenerate(token)
            setGenTaskId(r.task_id)
            setGenStatus('PENDING')
          }}
        >
          {genTaskId ? tt`生成中…${genStatus}` : t("立即生成本周盘点")}
        </Button>
      </CardHeader>
      <CardContent>
        {weeks.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("暂无内容，每周一自动生成，或点击右上角立即生成")}{' '}</p>
        )}
        {weeks.map((week) => (
          <div key={week} className="mb-3">
            <div className="mb-1 text-sm font-medium">{week}</div>
            <div className="flex flex-wrap gap-2">
              {items
                .filter((it) => it.week === week)
                .map((it) => (
                  <Button
                    key={it.path}
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => void downloadAdminContent(token, it.path, it.name)}
                  >
                    {it.name}
                  </Button>
                ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function FeedbackSection({ token }: { token: string }) {
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState<{ pending: number; items: AdminFeedbackItem[] } | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => {
    fetchAdminFeedback(token)
      .then(setFeedback)
      .catch(() => setFeedback(null))
  }, [token])

  if (!feedback) return null
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 sm:min-h-0"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          {t("用户反馈（最近 50 条）")}{' '}</span>
        <Badge variant={feedback.pending > 0 ? 'destructive' : 'secondary'}>
          {t("待处理")}{' '}{feedback.pending}
        </Badge>
      </button>
      {open && (
        <div className="space-y-1 border-t px-3 py-2">
          {feedback.items.length === 0 && (
            <p className="py-3 text-center text-xs text-muted-foreground">{t("暂无用户反馈")}</p>
          )}
          {feedback.items.map((f) => (
            <div
              key={f.id}
              className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1.5 py-1.5 text-xs ${
                f.handled ? 'opacity-50' : ''
              }`}
            >
              <Badge variant="secondary" className="shrink-0">
                {ISSUE_TYPE_LABELS[f.issue_type] || f.issue_type}
              </Badge>
              <a
                href={sampleHref(f.board, f.item_id)}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 font-mono text-primary underline-offset-2 hover:underline"
              >
                {BOARD_LABELS[f.board] || f.board} #{f.item_id}
              </a>
              {f.note && (
                <span className="max-w-60 truncate text-muted-foreground" title={f.note}>
                  {f.note}
                </span>
              )}
              <span className="text-muted-foreground">
                {f.created_at ? new Date(f.created_at).toLocaleString('zh-CN') : ''}
              </span>
              <Button
                size="sm"
                variant={f.handled ? 'ghost' : 'outline'}
                className="ml-auto min-h-11 shrink-0 px-2 text-xs sm:min-h-7"
                disabled={busy === f.id}
                onClick={async () => {
                  setBusy(f.id)
                  try {
                    await setFeedbackHandled(token, f.id, !f.handled)
                    setFeedback((cur) =>
                      cur
                        ? {
                            pending: cur.pending + (f.handled ? 1 : -1),
                            items: cur.items.map((x) =>
                              x.id === f.id ? { ...x, handled: !f.handled } : x,
                            ),
                          }
                        : cur,
                    )
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {f.handled ? t("恢复待处理") : t("标记已处理")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function QualityCard({
  quality,
  loading,
  token,
}: {
  quality: QualityIssues | null
  loading: boolean
  token: string
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (!quality && !loading) return null
  if (!quality) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("数据质量")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm text-muted-foreground">{t("扫描中，约 1 分钟…")}</div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" />
          ))}
        </CardContent>
      </Card>
    )
  }
  const found = quality.issues
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">{t("数据质量")}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {t("问题数据共")}{' '}{quality.total.toLocaleString()} {' '}{t("条 · 扫描于")}{' '}
          {new Date(quality.generated_at).toLocaleString('zh-CN')} {' '}{t("· 1h 缓存 · 只读展示")}{' '}</span>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {found.length === 0 && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {t("未扫描到已知类型的脏数据")}{' '}</div>
        )}
        {found.map((issue) => (
          <div key={issue.key} className={issue.count === 0 ? 'rounded-lg border border-dashed opacity-60' : 'rounded-lg border'}>
            <button
              type="button"
              className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 sm:min-h-0"
              aria-expanded={expanded === issue.key}
              onClick={() => setExpanded((k) => (k === issue.key ? null : issue.key))}
            >
              <span className="flex items-center gap-1.5">
                {expanded === issue.key ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className={issue.count === 0 ? 'text-muted-foreground' : undefined}>{issue.label}</span>
              </span>
              {issue.count === 0 ? (
                <span className="shrink-0 text-xs text-muted-foreground">{t("0 条 ✓")}</span>
              ) : (
                <Badge variant="secondary">{issue.count.toLocaleString()}</Badge>
              )}
            </button>
            {expanded === issue.key && (
              <div className="border-t px-3 py-2">
                {issue.note && (
                  <div className="mb-1 text-xs text-amber-700 dark:text-amber-300">{issue.note}</div>
                )}
                <div className="mb-1 text-xs text-muted-foreground">
                  {t("样例（最多")}{' '}{issue.samples.length} {' '}{t("条，点 id 直达详情）")}{' '}</div>
                <ul className="space-y-0.5 text-xs">
                  {issue.samples.map((s) => (
                    <li key={s.id} className="flex items-baseline gap-2">
                      <a
                        href={sampleHref(issue.board, s.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 font-mono text-primary underline-offset-2 hover:underline"
                      >
                        #{s.id}
                      </a>
                      <span className="truncate text-muted-foreground">{s.value || t("（空）")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
        <FeedbackSection token={token} />
      </CardContent>
    </Card>
  )
}

function HealthCard({ health, updatedAt, token }: { health: HealthSummary; updatedAt: Date | null; token: string }) {
  const cacheMissing = health.cache_ttl_seconds.stats <= 0 || health.cache_ttl_seconds.filters <= 0
  const hasFailures =
    health.crawl_24h.failed > 0 || health.failed_sources_yesterday.sources.length > 0
  const overall: 'green' | 'yellow' | 'red' = cacheMissing ? 'red' : hasFailures ? 'yellow' : 'green'
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" /> {' '}{t("系统健康")}{' '}{updatedAt && (
            <span className="text-xs font-normal text-muted-foreground">
              {t("更新于")}{' '}{formatClock(updatedAt)}
            </span>
          )}
        </CardTitle>
        <HealthBadge
          level={overall}
          label={overall === 'green' ? t("正常") : overall === 'yellow' ? t("有失败") : t("缓存缺失")}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">{t("24h 采集成功/失败")}</div>
            <div className="text-lg font-bold tabular-nums">
              <span className="text-green-600 dark:text-green-400">{health.crawl_24h.success}</span>
              {' / '}
              <span className={health.crawl_24h.failed > 0 ? 'text-red-600 dark:text-red-400' : ''}>
                {health.crawl_24h.failed}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">{t("共")}{' '}{health.crawl_24h.total} {' '}{t("次")}</div>
          </div>
          {(['stats', 'filters', 'dq_report'] as const).map((k) => (
            <div key={k}>
              <div className="text-xs text-muted-foreground">
                {{ stats: t("统计缓存"), filters: t("筛选缓存"), dq_report: t("质量报告") }[k]} TTL
              </div>
              <div className="text-lg font-bold tabular-nums">
                {formatTtl(health.cache_ttl_seconds[k])}
              </div>
              <HealthBadge
                level={health.cache_ttl_seconds[k] > 0 ? 'green' : k === 'dq_report' ? 'yellow' : 'red'}
                label={health.cache_ttl_seconds[k] > 0 ? t("热") : t("缺失")}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {Object.entries(health.table_estimates).map(([name, cnt]) => (
            <div key={name} className="rounded-lg border p-2">
              <div className="text-xs text-muted-foreground">{TABLE_LABELS[name] || name}</div>
              <div className="text-base font-bold tabular-nums">{cnt.toLocaleString()}</div>
            </div>
          ))}
        </div>

        {health.failed_sources_yesterday.sources.length > 0 && (
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950/30">
            <div className="mb-1 text-xs font-medium text-yellow-800 dark:text-yellow-300">
              {t("昨日失败来源（")}{health.failed_sources_yesterday.sources.length}）
            </div>
            <div className="flex flex-wrap gap-1">
              {health.failed_sources_yesterday.sources.map((s) => (
                <Badge key={s} variant="outline" className="text-yellow-800 dark:text-yellow-300">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {health.stale_sources && health.stale_sources.length > 0 && (
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950/30">
            <div className="mb-1 text-xs font-medium text-yellow-800 dark:text-yellow-300">
              {t("源可能失效（连续 2 天同步 0 新增，历史均值 &gt;0）")}{' '}</div>
            <ul className="space-y-0.5 text-xs text-yellow-800 dark:text-yellow-300">
              {health.stale_sources.map((s) => (
                <li key={s.name}>
                  {s.name} {' '}{t("· 历史日均 +")}{s.hist_avg_added} {' '}{t("· 最近成功：")}{' '}{s.last_success_at ? s.last_success_at.slice(0, 16).replace('T', ' ') : '—'}
                  {s.last_ingest_at && tt` · 最近有新增：${s.last_ingest_at.slice(0, 10)}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        <SyncTodaySection token={token} />

        {health.visits && health.visits.length > 0 && <VisitsSection visits={health.visits} />}

        {health.events && Object.keys(health.events).length > 0 && <EventsSection events={health.events} />}

        {health.trend && health.trend.length > 0 && <TrendSection trend={health.trend} />}

        {health.crawl_24h.latest_by_source.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3">{t("来源最近一次")}</th>
                  <th className="py-1.5 pr-3">{t("状态")}</th>
                  <th className="py-1.5 pr-3">{t("时间")}</th>
                  <th className="py-1.5 pr-3">{t("耗时")}</th>
                  <th className="py-1.5">{t("入库")}</th>
                </tr>
              </thead>
              <tbody>
                {health.crawl_24h.latest_by_source.map((s) => (
                  <tr key={s.source_id} className="border-b last:border-0">
                    <td className="max-w-[220px] truncate py-1.5 pr-3">{s.source_name || `#${s.source_id}`}</td>
                    <td className="py-1.5 pr-3">
                      <Badge className={`border-transparent ${RUN_STATUS_STYLES[s.status] || RUN_STATUS_STYLES.running}`}>
                        {RUN_STATUS_LABELS[s.status] || s.status}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-xs">
                      {s.started_at ? new Date(s.started_at).toLocaleString('zh-CN') : '-'}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-xs tabular-nums">
                      {s.duration_seconds != null ? tt`${s.duration_seconds} 秒` : '-'}
                    </td>
                    <td className="py-1.5 text-xs tabular-nums">{s.rows_ingested}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {health.data_quality?.rows && (
          <div className="text-xs text-muted-foreground">
            {t("质量审计：clean")}{' '}{health.data_quality.rows.clean.toLocaleString()} {' '}{t("/ 总")}{' '}
            {health.data_quality.rows.total.toLocaleString()}{t("，近 7 天新增")}{' '}
            {health.data_quality.rows.added_last_7d.toLocaleString()}
            {health.data_quality.deadline_parse_rate != null &&
              tt`，截止日期可解析率 ${(health.data_quality.deadline_parse_rate * 100).toFixed(1)}%`}
            {health.data_quality.generated_at &&
              tt` · 生成于 ${new Date(health.data_quality.generated_at).toLocaleString('zh-CN')}`}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** 今日同步结果明细 + 立即触发同步（唯一写操作，带确认与进行中状态）。 */
function SyncTodaySection({ token }: { token: string }) {
  const [detail, setDetail] = useState<{ date: string; items: SyncTodayItem[] } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const loadDetail = useCallback(() => {
    fetchSyncToday(token)
      .then(setDetail)
      .catch(() => undefined)
  }, [token])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const trigger = async () => {
    setConfirming(false)
    setRunning(true)
    setSyncMsg(null)
    try {
      const { task_id } = await triggerSyncNow(token)
      const deadline = Date.now() + 180_000
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000))
        const s = await fetchSyncStatus(token, task_id)
        if (s.state === 'SUCCESS') {
          setSyncMsg({ ok: true, text: t("同步完成，明细已刷新") })
          break
        }
        if (s.state === 'FAILURE') {
          setSyncMsg({ ok: false, text: tt`同步失败：${s.error || '未知错误'}` })
          break
        }
        if (Date.now() > deadline) {
          setSyncMsg({ ok: false, text: t("同步仍在后台进行（超 3 分钟），稍后刷新查看明细") })
          break
        }
      }
    } catch (e) {
      setSyncMsg({ ok: false, text: e instanceof Error ? e.message : t("触发失败") })
    } finally {
      setRunning(false)
      loadDetail()
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{t("今日同步结果")}{detail ? `（${detail.date}）` : ''}</span>
        {confirming ? (
          <span className="inline-flex items-center gap-1 text-xs">
            {t("确认立即触发飞书数据同步？")}{' '}<Button size="sm" variant="destructive" className="h-auto min-h-11 text-xs sm:min-h-7" onClick={trigger}>
              {t("确认触发")}{' '}</Button>
            <Button size="sm" variant="ghost" className="h-auto min-h-11 text-xs sm:min-h-7" onClick={() => setConfirming(false)}>
              {t("取消")}{' '}</Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-auto min-h-11 gap-1 text-xs sm:min-h-7"
            disabled={running}
            onClick={() => setConfirming(true)}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} />
            {running ? t("同步进行中…") : t("立即触发同步")}
          </Button>
        )}
        {syncMsg && (
          <span className={`text-xs ${syncMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {syncMsg.text}
          </span>
        )}
      </div>
      {detail && detail.items.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("今日暂无同步记录（每日 6:20 自动同步，或点上方按钮立即触发）")}</p>
      )}
      {detail && detail.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-3">{t("来源")}</th>
                <th className="py-1.5 pr-3">{t("状态")}</th>
                <th className="py-1.5 pr-3">{t("新增")}</th>
                <th className="py-1.5">{t("失败原因")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((s) => (
                <tr key={s.source_id} className="border-b last:border-0">
                  <td className="max-w-[200px] truncate py-1.5 pr-3">{s.source_name}</td>
                  <td className="py-1.5 pr-3">
                    <Badge className={`border-transparent ${RUN_STATUS_STYLES[s.status] || RUN_STATUS_STYLES.running}`}>
                      {RUN_STATUS_LABELS[s.status] || s.status}
                    </Badge>
                  </td>
                  <td className="py-1.5 pr-3 text-xs tabular-nums">{s.rows_ingested}</td>
                  <td className="max-w-[260px] truncate py-1.5 text-xs text-red-600 dark:text-red-400" title={s.error || undefined}>
                    {s.status === 'success' ? '-' : s.error || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** 补齐近 14 天日槽（无数据日用零值占位），保证等宽列不因稀疏数据拉伸 */
function padDays<T extends { date: string }>(rows: T[], makeEmpty: (date: string) => T): T[] {
  const byDate = new Map(rows.map((r) => [r.date, r]))
  const out: T[] = []
  const now = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out.push(byDate.get(key) ?? makeEmpty(key))
  }
  return out
}

function VisitsSection({ visits: rawVisits }: { visits: HealthVisitDay[] }) {
  const visits = padDays(rawVisits, (date) => ({ date, pv: 0, sessions: 0 }))
  const maxPv = Math.max(1, ...visits.map((d) => d.pv))
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-xs text-muted-foreground">
        {t("近 14 天访问趋势（自建统计 · 无第三方跟踪）")}{' '}<span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-sky-500" /> PV
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-emerald-500" /> {' '}{t("独立会话（估算）")}{' '}</span>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-[420px] items-end gap-1">
          {visits.map((d) => {
            const ph = Math.round((d.pv / maxPv) * 48)
            const sh = Math.round((d.sessions / maxPv) * 48)
            return (
              <div
                key={d.date}
                title={tt`${d.date}：PV ${d.pv}，独立会话 ${d.sessions}`}
                className="flex flex-1 flex-col items-center gap-1 rounded-md px-0.5 pb-1 pt-1"
              >
                <span className="flex h-12 w-full max-w-6 items-end justify-center gap-px">
                  <span
                    className="w-1/2 rounded-sm bg-sky-500 dark:bg-sky-600"
                    style={{ height: `${d.pv > 0 ? Math.max(ph, 2) : 0}px` }}
                  />
                  <span
                    className="w-1/2 rounded-sm bg-emerald-500 dark:bg-emerald-600"
                    style={{ height: `${d.sessions > 0 ? Math.max(sh, 2) : 0}px` }}
                  />
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {d.date.slice(5).replace('-', '/')}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const EVENT_LABELS: Record<string, string> = {
  remind_set: t("设提醒"),
  save_filter: t("保存筛选"),
  new_since_click: t("新增岗位提示条点击"),
}

function EventsSection({ events }: { events: Record<string, number> }) {
  const applyClick = events['apply_click'] ?? 0
  const applyMarked = events['apply_marked'] ?? 0
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{t("近 14 天留存事件")}</span>
        {Object.entries(EVENT_LABELS).map(([key, label]) => (
          <span key={key} className="inline-flex items-center gap-1">
            {label}
            <span className="font-semibold tabular-nums text-foreground">{events[key] ?? 0}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{t("投递漏斗")}</span>
        <span className="inline-flex items-center gap-1">
          {t("点原文")}
          <span className="font-semibold tabular-nums text-foreground">{applyClick}</span>
        </span>
        <span aria-hidden="true">→</span>
        <span className="inline-flex items-center gap-1">
          {t("标记投递")}
          <span className="font-semibold tabular-nums text-foreground">{applyMarked}</span>
        </span>
        {applyClick > 0 && (
          <span className="tabular-nums">({Math.round((applyMarked / applyClick) * 100)}%)</span>
        )}
      </div>
    </div>
  )
}

function TrendSection({ trend: rawTrend }: { trend: HealthTrendDay[] }) {
  const trend = padDays(rawTrend, (date) => ({
    date,
    crawl_success: 0,
    crawl_fail: 0,
    campus_added: 0,
    bianzhi_added: 0,
  }))
  const [selected, setSelected] = useState<number | null>(null)
  const maxCrawl = Math.max(1, ...trend.map((d) => d.crawl_success + d.crawl_fail))
  const maxAdded = Math.max(1, ...trend.map((d) => d.campus_added + d.bianzhi_added))
  const day = selected != null ? trend[selected] : null
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-xs text-muted-foreground">
        {t("近 14 天趋势")}{' '}<span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-green-500" /> {' '}{t("采集成功")}{' '}</span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-red-500" /> {' '}{t("失败")}{' '}</span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-primary" /> {' '}{t("校招新增")}{' '}</span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-violet-500" /> {' '}{t("编制新增")}{' '}</span>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-[420px] items-end gap-1">
          {trend.map((d, i) => {
            const sh = Math.round(((d.crawl_success / maxCrawl) * 48))
            const fh = Math.round(((d.crawl_fail / maxCrawl) * 48))
            const ch = Math.round((d.campus_added / maxAdded) * 20)
            const bh = Math.round((d.bianzhi_added / maxAdded) * 20)
            return (
              <button
                key={d.date}
                type="button"
                title={tt`${d.date}：成功 ${d.crawl_success} / 失败 ${d.crawl_fail}，校招 +${d.campus_added}，编制 +${d.bianzhi_added}`}
                onClick={() => setSelected((s) => (s === i ? null : i))}
                className={`flex flex-1 flex-col items-center gap-1 rounded-md px-0.5 pb-1 pt-1 transition-colors hover:bg-muted ${
                  selected === i ? 'bg-muted' : ''
                }`}
              >
                <span className="flex h-12 w-full max-w-6 flex-col justify-end overflow-hidden rounded-sm">
                  <span
                    className="w-full bg-red-500 dark:bg-red-600"
                    style={{ height: `${d.crawl_fail > 0 ? Math.max(fh, 2) : 0}px` }}
                  />
                  <span
                    className="w-full bg-green-500 dark:bg-green-600"
                    style={{ height: `${d.crawl_success > 0 ? Math.max(sh, 2) : 0}px` }}
                  />
                </span>
                <span className="flex h-5 w-full max-w-6 items-end justify-center gap-px">
                  <span
                    className="w-1/2 rounded-sm bg-primary"
                    style={{ height: `${d.campus_added > 0 ? Math.max(ch, 2) : 0}px` }}
                  />
                  <span
                    className="w-1/2 rounded-sm bg-violet-500 dark:bg-violet-600"
                    style={{ height: `${d.bianzhi_added > 0 ? Math.max(bh, 2) : 0}px` }}
                  />
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {d.date.slice(5).replace('-', '/')}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      {day && (
        <div className="mt-1 rounded-md bg-muted px-2.5 py-1.5 text-xs tabular-nums">
          {day.date}{t("：采集成功")}{' '}
          <span className="font-medium text-green-600 dark:text-green-400">{day.crawl_success}</span> {' '}{t("/ 失败")}{' '}
          <span className={day.crawl_fail > 0 ? 'font-medium text-red-600 dark:text-red-400' : 'font-medium'}>
            {day.crawl_fail}
          </span>
          {t("，校招新增")}{' '}<span className="font-medium text-primary">{day.campus_added}</span>{t("，编制新增")}{' '}
          <span className="font-medium text-violet-600 dark:text-violet-400">{day.bianzhi_added}</span>
        </div>
      )}
    </div>
  )
}

function runDuration(started: string | null, finished: string | null): string {
  if (!started || !finished) return '-'
  const ms = new Date(finished).getTime() - new Date(started).getTime()
  if (isNaN(ms) || ms < 0) return '-'
  const s = Math.round(ms / 1000)
  if (s < 60) return tt`${s} 秒`
  return tt`${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

function RunRow({
  run,
  sourceName,
  expanded,
  onToggle,
}: {
  run: CrawlRun
  sourceName?: string
  expanded: boolean
  onToggle: () => void
}) {
  const hasError = !!run.error
  return (
    <>
      <tr
        className={`border-b ${hasError ? 'cursor-pointer hover:bg-muted/50' : ''} ${expanded ? 'bg-muted/30' : ''}`}
        onClick={hasError ? onToggle : undefined}
        title={hasError && !expanded ? run.error || '' : undefined}
      >
        <td className="py-2 pr-3 text-xs tabular-nums text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {hasError &&
              (expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
            {run.id}
          </span>
        </td>
        <td className="max-w-[200px] truncate py-2 pr-3">{sourceName || (run.source_id ? `#${run.source_id}` : '-')}</td>
        <td className="whitespace-nowrap py-2 pr-3 text-xs">
          {run.started_at ? new Date(run.started_at).toLocaleString('zh-CN') : '-'}
        </td>
        <td className="whitespace-nowrap py-2 pr-3 text-xs">{runDuration(run.started_at, run.finished_at)}</td>
        <td className="py-2 pr-3">
          <Badge className={`border-transparent ${RUN_STATUS_STYLES[run.status] || RUN_STATUS_STYLES.running}`}>
            {RUN_STATUS_LABELS[run.status] || run.status}
          </Badge>
        </td>
        <td className="py-2 pr-3 tabular-nums">{run.announcements_found}</td>
        <td className="py-2 pr-3 tabular-nums">{run.attachments_downloaded}</td>
        <td className="py-2 pr-3 tabular-nums">{run.rows_parsed}</td>
        <td className="py-2 tabular-nums">{run.rows_ingested}</td>
      </tr>
      {expanded && hasError && (
        <tr className="border-b bg-red-50/60 dark:bg-red-950/20">
          <td colSpan={9} className="whitespace-pre-wrap break-all px-3 py-2 text-xs text-red-700 dark:text-red-400">
            {run.error}
          </td>
        </tr>
      )}
    </>
  )
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold tabular-nums">{value.toLocaleString()}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}
