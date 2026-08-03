import { useRef } from 'react'

const DIST_THRESHOLD = 120
const VELOCITY_THRESHOLD = 0.5

/** 移动端详情抽屉拖拽手柄：下滑超距离或速度阈值关闭，桌面端隐藏不受影响。 */
export function SheetDragHandle({ onDismiss }: { onDismiss: () => void }) {
  const start = useRef<{ y: number; t: number } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const panel = () => barRef.current?.closest<HTMLElement>('[data-slot="sheet-content"]') ?? null

  const onTouchStart = (e: React.TouchEvent) => {
    start.current = { y: e.touches[0].clientY, t: Date.now() }
    const p = panel()
    if (p) p.style.transition = 'none'
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return
    const dy = Math.max(0, e.touches[0].clientY - start.current.y)
    const p = panel()
    if (p) p.style.transform = `translateY(${dy}px)`
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!start.current) return
    const dy = Math.max(0, e.changedTouches[0].clientY - start.current.y)
    const dt = Math.max(1, Date.now() - start.current.t)
    start.current = null
    const p = panel()
    if (p) {
      p.style.transition = ''
      p.style.transform = ''
    }
    if (dy >= DIST_THRESHOLD || (dy >= 40 && dy / dt >= VELOCITY_THRESHOLD)) onDismiss()
  }

  return (
    <div
      ref={barRef}
      className="flex min-h-11 shrink-0 cursor-grab touch-none items-center justify-center sm:hidden"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      aria-hidden
      data-testid="sheet-drag-handle"
    >
      <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
    </div>
  )
}
