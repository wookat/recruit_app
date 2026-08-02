import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

const TRIGGER = 40
const MAX_PULL = 110
const MAX_SPIN_MS = 10000

/** 容器自身滚动位置门控：最近可滚动祖先 scrollTop≈2，无则用包裹层 rect.top 判定。 */
function atListTop(el: HTMLElement | null): boolean {
  if (!el) return false
  let node = el.parentElement
  while (node) {
    const style = getComputedStyle(node)
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) {
      return node.scrollTop <= 2
    }
    node = node.parentElement
  }
  return el.getBoundingClientRect().top >= -2
}

/** 移动端列表下拉刷新：页面顶部下拉超过阈值触发 onRefresh，带旋转指示；桌面端直接透传。 */
export function PullToRefresh({
  onRefresh,
  refreshing,
  disabled,
  children,
}: {
  onRefresh: () => void
  refreshing: boolean
  disabled?: boolean
  children: ReactNode
}) {
  const [pull, setPull] = useState(0)
  const [active, setActive] = useState(false)
  const startY = useRef<number | null>(null)
  const pullRef = useRef(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const sawRefreshing = useRef(false)
  const triggeredAt = useRef(0)

  useEffect(() => {
    if (!active) return
    if (refreshing) {
      sawRefreshing.current = true
      return
    }
    // 请求已完成（含失败），或触发后从未观察到 refreshing（给 600ms 宽限）
    if (sawRefreshing.current || Date.now() - triggeredAt.current > 600) {
      setActive(false)
      return
    }
    const t = setTimeout(() => setActive(false), 600)
    return () => clearTimeout(t)
  }, [active, refreshing])

  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => setActive(false), MAX_SPIN_MS)
    return () => clearTimeout(t)
  }, [active])

  const reset = () => {
    startY.current = null
    pullRef.current = 0
    setPull(0)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    if (disabled || active) return
    if (!atListTop(wrapRef.current)) return
    startY.current = e.touches[0].clientY
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return
    const dy = e.touches[0].clientY - startY.current
    if (dy <= 0 || !atListTop(wrapRef.current)) {
      pullRef.current = 0
      setPull(0)
      return
    }
    pullRef.current = Math.min(MAX_PULL, dy * 0.5)
    setPull(pullRef.current)
  }

  const onTouchEnd = () => {
    if (startY.current === null) return
    if (pullRef.current >= TRIGGER) {
      triggeredAt.current = Date.now()
      sawRefreshing.current = false
      setActive(true)
      onRefresh()
    }
    reset()
  }

  const showing = pull > 8 || active
  return (
    <div
      ref={wrapRef}
      className="relative sm:contents"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={reset}
    >
      {showing && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center sm:hidden"
          style={{ transform: `translateY(${active ? 12 : Math.max(0, pull - 34)}px)` }}
          aria-hidden
        >
          <span className="rounded-full border bg-background p-2 shadow-sm">
            <RefreshCw
              className={cn('h-4 w-4 text-muted-foreground', active && 'animate-spin text-primary')}
              style={active ? undefined : { transform: `rotate(${pull * 2.6}deg)` }}
            />
          </span>
        </div>
      )}
      <div style={pull > 0 ? { transform: `translateY(${pull}px)`, transition: 'none' } : { transition: 'transform 150ms' }}>
        {children}
      </div>
    </div>
  )
}
