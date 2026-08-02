import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

const TRIGGER = 70
const MAX_PULL = 110

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
  const triggeredAt = useRef(0)

  useEffect(() => {
    if (active && !refreshing && Date.now() - triggeredAt.current > 400) setActive(false)
  }, [active, refreshing])

  const reset = () => {
    startY.current = null
    pullRef.current = 0
    setPull(0)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    if (disabled || active) return
    if (window.scrollY > 2) return
    startY.current = e.touches[0].clientY
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return
    const dy = e.touches[0].clientY - startY.current
    if (dy <= 0 || window.scrollY > 2) {
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
      setActive(true)
      onRefresh()
    }
    reset()
  }

  const showing = pull > 8 || active
  return (
    <div
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
