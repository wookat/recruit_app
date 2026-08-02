import { useEffect, useState } from 'react'
import { fetchBianzhiJobs, fetchCampusJobs, fetchDeadlines } from '@/api'
import { AlarmClock, BriefcaseBusiness, Landmark, Sparkles, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// hide_expired 计数模块级缓存，会话内只请求一次
let campusActiveCache: number | null = null
let bianzhiActiveCache: number | null = null

interface Props {
  /** 打开「今日更新」页（近 7 天三板块新增按日聚合） */
  onUpdates?: () => void
  onCampus: () => void
  /** 直达校招全部预设（有效岗位胶囊用，区别于近7天回调） */
  onCampusAll: () => void
  onBianzhi: () => void
  onDeadline: () => void
}

function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const PILL =
  'flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 sm:min-h-9'

export function TodayGlance({ onUpdates, onCampus, onCampusAll, onBianzhi, onDeadline }: Props) {
  const [campusNew, setCampusNew] = useState<number | null>(null)
  const [campusActive, setCampusActive] = useState<number | null>(campusActiveCache)
  const [bianzhiActive, setBianzhiActive] = useState<number | null>(bianzhiActiveCache)
  const [bianzhiTotal, setBianzhiTotal] = useState<number | null>(null)
  const [bianzhiDue, setBianzhiDue] = useState<number | null>(null)
  const [deadlineCount, setDeadlineCount] = useState<number | null>(null)

  useEffect(() => {
    fetchCampusJobs({ updated_after: isoDaysAgo(7), page: 1, page_size: 1 })
      .then((r) => setCampusNew(r.total))
      .catch(() => undefined)
    fetchBianzhiJobs({ due_within_days: 7, page: 1, page_size: 1 })
      .then((r) => {
        if (r.total > 0) {
          setBianzhiDue(r.total)
          return
        }
        return fetchBianzhiJobs({ page: 1, page_size: 1 }).then((r2) => setBianzhiTotal(r2.total))
      })
      .catch(() => undefined)
    fetchDeadlines(7, 100)
      .then((list) => setDeadlineCount(list.length))
      .catch(() => undefined)
    if (campusActiveCache === null) {
      fetchCampusJobs({ hide_expired: true, page: 1, page_size: 1 })
        .then((r) => {
          campusActiveCache = r.total
          setCampusActive(r.total)
        })
        .catch(() => undefined)
    }
    if (bianzhiActiveCache === null) {
      fetchBianzhiJobs({ hide_expired: true, page: 1, page_size: 1 })
        .then((r) => {
          bianzhiActiveCache = r.total
          setBianzhiActive(r.total)
        })
        .catch(() => undefined)
    }
  }, [])

  const items = [
    onUpdates && (
      <button key="updates" type="button" className={PILL} onClick={onUpdates}>
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        今日更新：近 7 天新增一览
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
      </button>
    ),
    campusNew !== null && campusNew > 0 && (
      <button key="campus" type="button" className={PILL} onClick={onCampus}>
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        校招近 7 天新增 <span className="font-semibold text-primary">{campusNew.toLocaleString()}</span> 条
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
      </button>
    ),
    bianzhiDue !== null && bianzhiDue > 0 ? (
      <button
        key="bianzhi-due"
        type="button"
        className={PILL}
        onClick={() => {
          const q = new URLSearchParams(window.location.search)
          q.set('due', '7')
          window.history.replaceState(null, '', `?${q.toString()}`)
          onBianzhi()
        }}
      >
        <Landmark className="h-3.5 w-3.5 text-primary" />
        编制即将截止 <span className="font-semibold text-primary">{bianzhiDue.toLocaleString()}</span> 条
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
      </button>
    ) : bianzhiTotal !== null && bianzhiTotal > 0 ? (
      <button key="bianzhi" type="button" className={PILL} onClick={onBianzhi}>
        <Landmark className="h-3.5 w-3.5 text-primary" />
        编制公告 <span className="font-semibold text-primary">{bianzhiTotal.toLocaleString()}</span> 条
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
      </button>
    ) : null,
    campusActive !== null && campusActive > 0 && (
      <button
        key="campus-active"
        type="button"
        className={PILL}
        onClick={() => {
          const q = new URLSearchParams(window.location.search)
          q.set('hexp', '1')
          window.history.replaceState(null, '', `?${q.toString()}`)
          onCampusAll()
        }}
      >
        <BriefcaseBusiness className="h-3.5 w-3.5 text-primary" />
        校招有效岗位 <span className="font-semibold text-primary">{campusActive.toLocaleString()}</span> 条
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
      </button>
    ),
    bianzhiActive !== null && bianzhiActive > 0 && (
      <button
        key="bianzhi-active"
        type="button"
        className={PILL}
        onClick={() => {
          const q = new URLSearchParams(window.location.search)
          q.set('hexp', '1')
          window.history.replaceState(null, '', `?${q.toString()}`)
          onBianzhi()
        }}
      >
        <Landmark className="h-3.5 w-3.5 text-primary" />
        编制有效岗位 <span className="font-semibold text-primary">{bianzhiActive.toLocaleString()}</span> 条
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
      </button>
    ),
    deadlineCount !== null && deadlineCount > 0 && (
      <button key="deadline" type="button" className={PILL} onClick={onDeadline}>
        <AlarmClock className="h-3.5 w-3.5 text-primary" />
        体制内即将截止{' '}
        <span className="font-semibold text-primary">
          {deadlineCount >= 100 ? '100+' : deadlineCount.toLocaleString()}
        </span>{' '}
        条
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
      </button>
    ),
  ].filter(Boolean)

  if (items.length === 0) return null

  return (
    <div className="scrollbar-none -mx-1 flex items-center gap-2 overflow-x-auto px-1 py-0.5">
      <span
        className={cn(
          'shrink-0 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground',
        )}
      >
        今日速览
      </span>
      {items}
    </div>
  )
}
