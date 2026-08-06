import { t, tt } from '@/lib/i18n'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fetchNewSince, type NewSinceCounts } from '@/api'
import { getPrevVisit, type VisitBoard } from '@/lib/lastVisit'
import { reportEvent } from '@/lib/metrics'

const SESSION_KEY = 'recruit.newSinceShown'

function sessionShown(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return true
  }
}

function markSessionShown() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    // ignore
  }
}

// 新增提示条在屏状态（全局共享）：截止卡片据此避让，同屏只出一条（优先级：新增 > 截止）
let onScreen = false
const onScreenListeners = new Set<() => void>()

function setOnScreen(v: boolean) {
  if (v === onScreen) return
  onScreen = v
  for (const l of onScreenListeners) l()
}

export function useNewSinceOnScreen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      onScreenListeners.add(cb)
      return () => onScreenListeners.delete(cb)
    },
    () => onScreen,
  )
}

const cached = new Map<number, Promise<NewSinceCounts | null>>()

function loadCounts(since: number): Promise<NewSinceCounts | null> {
  let p = cached.get(since)
  if (!p) {
    p = fetchNewSince(new Date(since).toISOString()).catch(() => null)
    cached.set(since, p)
  }
  return p
}

/** 回访者提示条：「自上次访问新增 N 个岗位」，点击筛选出这些新岗位；每会话最多显示一次，可关闭。 */
export function NewSinceBanner({
  board,
  onApply,
}: {
  board: VisitBoard
  /** 点击「查看」时应用 created_after 筛选（ISO 时间字符串）。 */
  onApply: (sinceIso: string) => void
}) {
  const prev = getPrevVisit(board)
  const [count, setCount] = useState<number | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!prev || sessionShown()) return
    let alive = true
    void loadCounts(prev).then((counts) => {
      if (!alive || !counts) return
      const n = counts[board] ?? 0
      if (n > 0 && !sessionShown()) {
        markSessionShown()
        setCount(n)
        setVisible(true)
        setOnScreen(true)
      }
    })
    return () => {
      alive = false
    }
  }, [prev, board])

  useEffect(() => {
    if (!visible) return
    return () => setOnScreen(false)
  }, [visible])

  if (!visible || !count || !prev) return null

  return (
    <section className="relative mb-4 animate-fade-in-up rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-4 py-3">
      <button
        type="button"
        aria-label={t("关闭新增岗位提示条")}
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:h-8 sm:w-8"
        onClick={() => setVisible(false)}
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-10">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          {tt`自上次访问新增 ${count} 个岗位`}
        </p>
        <Button
          size="sm"
          className="min-h-11 sm:min-h-8"
          onClick={() => {
            reportEvent('new_since_click')
            setVisible(false)
            onApply(new Date(prev).toISOString())
          }}
        >
          {t("只看这些新岗位")}
        </Button>
      </div>
    </section>
  )
}
