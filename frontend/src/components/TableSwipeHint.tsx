import { useEffect, useState } from 'react'
import { MoveHorizontal } from 'lucide-react'

const KEY = 'recruit.tableSwipeHintSeen'

/** 移动端表格模式首次进入的一次性可横滑提示（localStorage 记忆）。 */
export function TableSwipeHint() {
  const [show, setShow] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 639px)').matches &&
      localStorage.getItem(KEY) !== '1',
  )

  useEffect(() => {
    if (!show) return
    const t = setTimeout(() => {
      localStorage.setItem(KEY, '1')
      setShow(false)
    }, 6000)
    return () => clearTimeout(t)
  }, [show])

  if (!show) return null
  return (
    <div
      className="sticky left-0 flex justify-center py-1.5 sm:hidden"
      onClick={() => {
        localStorage.setItem(KEY, '1')
        setShow(false)
      }}
      data-testid="table-swipe-hint"
    >
      <span className="inline-flex items-center gap-1.5 rounded-md bg-foreground/80 px-3 py-1.5 text-xs text-background shadow-sm">
        <MoveHorizontal className="h-3.5 w-3.5" /> 表格可左右滑动查看更多列
      </span>
    </div>
  )
}
