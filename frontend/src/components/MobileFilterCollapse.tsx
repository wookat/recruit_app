import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

interface Props {
  /** 当前生效的筛选数量，显示在按钮上 */
  count: number
  title?: string
  children: ReactNode
}

/** 移动端（<768px）筛选区：内容超过约两行时自动折叠为「筛选 (N)」按钮，点击弹出底部 Sheet。 */
export function MobileFilterCollapse({ count, title = '全部筛选', children }: Props) {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const measureRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    const mq = window.matchMedia('(max-width: 767px)')
    const check = () => setCollapsed(mq.matches && el.scrollHeight > 100)
    check()
    mq.addEventListener('change', check)
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      mq.removeEventListener('change', check)
      ro.disconnect()
    }
  }, [])

  return (
    <div className="relative md:hidden">
      <div
        ref={measureRef}
        inert
        aria-hidden="true"
        className="invisible absolute inset-x-0 top-0 -z-10 space-y-3"
      >
        {children}
      </div>
      {collapsed ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-11 gap-1.5"
            onClick={() => setOpen(true)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            筛选{count > 0 ? ` (${count})` : ''}
          </Button>
          <Sheet open={open} onOpenChange={(v) => !v && setOpen(false)}>
            <SheetContent
              side="bottom"
              className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-4"
            >
              <SheetHeader className="px-0 pt-0">
                <SheetTitle>{title}</SheetTitle>
              </SheetHeader>
              <div className="space-y-3">{children}</div>
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </div>
  )
}
