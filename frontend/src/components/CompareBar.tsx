import { lazy, Suspense, useState } from 'react'
import { Scale, X } from 'lucide-react'
import { clearCompare, toggleCompare, useCompare, COMPARE_MAX } from '@/lib/positionStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const CompareDialog = lazy(() =>
  import('./CompareDialog').then((m) => ({ default: m.CompareDialog })),
)

export function CompareBar() {
  const compare = useCompare()
  const [open, setOpen] = useState(false)

  if (compare.length === 0) return null

  return (
    <>
      <div className="fixed inset-x-0 bottom-14 z-40 border-t md:bottom-0 bg-background/95 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2.5">
          <Scale className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 text-sm font-medium">
            <span className="hidden sm:inline">对比栏</span>（{compare.length}/{COMPARE_MAX}）
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {compare.map((p) => (
              <Badge key={p.id} variant="secondary" className="max-w-[120px] gap-1 font-normal sm:max-w-[180px]">
                <span className="truncate">{p.position_example || p.exam_type || p.employer || `#${p.id}`}</span>
                <button
                  type="button"
                  aria-label="移出对比"
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                  onClick={() => toggleCompare(p)}
                >
                  <X className="pointer-events-none h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={clearCompare}>
              清空
            </Button>
            <Button size="sm" className="h-8" disabled={compare.length < 2} onClick={() => setOpen(true)}>
              开始对比{compare.length < 2 ? '（至少2个）' : ''}
            </Button>
          </div>
        </div>
      </div>
      <Suspense fallback={null}>
        {open && <CompareDialog open={open} onClose={() => setOpen(false)} items={compare} />}
      </Suspense>
    </>
  )
}
