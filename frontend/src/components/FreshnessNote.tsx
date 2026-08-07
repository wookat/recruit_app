import { t, tt } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { fetchFreshness } from '@/api'
import { Skeleton } from '@/components/ui/skeleton'

function formatFreshness(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const hours = (Date.now() - d.getTime()) / 3600000
  if (hours < 1) return t("刚刚更新")
  const h = Math.floor(hours)
  if (hours <= 48) return h === 1 ? t("数据更新于 1 小时前") : tt`数据更新于 ${h} 小时前`
  return tt`数据更新于 ${iso.slice(0, 10)}`
}

export function FreshnessNote({
  board,
  showTotal,
}: {
  board: 'positions' | 'campus' | 'bianzhi'
  showTotal?: boolean
}) {
  const [text, setText] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchFreshness()
      .then((f) => {
        if (cancelled) return
        setText(formatFreshness(f[board].last_success))
        setTotal(typeof f[board].total === 'number' ? f[board].total : null)
        setLoaded(true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [board])

  if (showTotal) {
    // 数据说明用：条数 + 同步时间，取不到的数字显示「—」不伪造
    if (!loaded) return <span className="text-xs text-muted-foreground">—</span>
    return (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {total != null ? tt`${total.toLocaleString()} 条` : '—'} · {text ?? t("同步时间 —")}
      </span>
    )
  }
  if (!text) return null
  return <span className="whitespace-nowrap text-xs text-muted-foreground">{text}</span>
}

const SOURCE_LABELS: Record<string, string> = {
  feishu_campus: t("校招飞书表"),
  feishu_bianzhi: t("编制飞书表"),
}

/** 数据说明用：各采集源最近一次成功同步时间（取不到不渲染，不伪造）。 */
export function SourceFreshness() {
  const [sources, setSources] = useState<Record<string, string> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchFreshness()
      .then((f) => {
        if (cancelled) return
        if (f.sources && Object.keys(f.sources).length > 0) setSources(f.sources)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-40" />
      </div>
    )
  }
  if (!sources) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2">
      <span className="text-xs font-medium text-foreground/70">{t("各源最近成功同步")}</span>
      {Object.entries(sources).map(([name, iso]) => (
        <span key={name} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {SOURCE_LABELS[name] || name}：{iso.slice(0, 16).replace('T', ' ')}
        </span>
      ))}
    </div>
  )
}
