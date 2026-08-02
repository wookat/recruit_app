import { lazy, Suspense, useEffect, useState } from 'react'
import { Scale, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCompare } from '@/lib/positionStore'
import {
  BOARD_COMPARE_MAX,
  clearBoardCompare,
  clearBoardCompareHint,
  removeBoardCompare,
  toggleBoardCompare,
  useBoardCompare,
  useBoardCompareHint,
  type BoardCompareBoard,
} from '@/lib/boardCompare'
import type { FavCompareColumn } from './FavCompareDialog'
import { cn } from '@/lib/utils'

const FavCompareDialog = lazy(() =>
  import('./FavCompareDialog').then((m) => ({ default: m.FavCompareDialog })),
)

/** 校招/编制列表页对比浮条：已选 chips + 开始对比，复用收藏对比弹窗与差异高亮。 */
export function BoardCompareBar({
  onOpenJob,
}: {
  onOpenJob: (board: BoardCompareBoard, id: number) => void
}) {
  const items = useBoardCompare()
  const hint = useBoardCompareHint()
  const positionsCompare = useCompare()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open && items.length < 2) setOpen(false)
  }, [open, items.length])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(clearBoardCompareHint, 2500)
    return () => clearTimeout(t)
  }, [hint])

  if (items.length === 0) return null

  const columns: FavCompareColumn[] = items.map((s) => {
    const common = {
      onRemove: () => removeBoardCompare(s.board, s.job.id),
      onOpenDetail: () => {
        setOpen(false)
        onOpenJob(s.board, s.job.id)
      },
    }
    if (s.board === 'campus') {
      const j = s.job
      return {
        key: `campus-${j.id}`,
        title: j.company || '-',
        badge: j.company_type || undefined,
        ...common,
        fields: [
          { label: '岗位', value: j.positions || '-' },
          { label: '行业', value: j.industry || '-' },
          { label: '批次', value: j.batch || '-' },
          { label: '工作地点', value: j.locations || '-' },
          { label: '学历要求', value: j.edu_requirement || '-' },
          { label: '专业要求', value: j.major_requirement || '-' },
          { label: '截止', value: j.deadline_text || '-' },
        ],
      }
    }
    const j = s.job
    return {
      key: `bianzhi-${j.id}`,
      title: j.employer || j.category || '-',
      badge: j.category || undefined,
      ...common,
      fields: [
        { label: '省份', value: j.province || '-' },
        { label: '岗位类型', value: j.job_type || '-' },
        { label: '招聘人数', value: j.headcount || '-' },
        { label: '工作地点', value: j.work_location || '-' },
        { label: '学历要求', value: j.edu_requirement || '-' },
        { label: '专业要求', value: j.major_requirement || '-' },
        { label: '截止', value: j.deadline_text || '-' },
      ],
    }
  })

  return (
    <>
      <div
        className={cn(
          'fixed inset-x-0 z-40 border-t bg-background/95 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] backdrop-blur',
          positionsCompare.length > 0 ? 'bottom-[7.5rem] md:bottom-[3.75rem]' : 'bottom-14 md:bottom-0',
        )}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2.5">
          <Scale className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 text-sm font-medium">
            <span className="hidden sm:inline">对比栏</span>（{items.length}/{BOARD_COMPARE_MAX}）
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {items.map((s) => (
              <Badge
                key={`${s.board}-${s.job.id}`}
                variant="secondary"
                className="max-w-[120px] gap-1 font-normal sm:max-w-[180px]"
              >
                <span className="truncate">
                  {s.board === 'campus' ? s.job.company || `#${s.job.id}` : s.job.employer || `#${s.job.id}`}
                </span>
                <button
                  type="button"
                  aria-label="移出对比"
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                  onClick={() => toggleBoardCompare(s)}
                >
                  <X className="pointer-events-none h-3 w-3" />
                </button>
              </Badge>
            ))}
            {hint && <span className="text-xs text-destructive">{hint}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={clearBoardCompare}>
              清空
            </Button>
            <Button size="sm" className="h-8" disabled={items.length < 2} onClick={() => setOpen(true)}>
              开始对比{items.length < 2 ? '（至少2条）' : ''}
            </Button>
          </div>
        </div>
      </div>
      <Suspense fallback={null}>
        {open && (
          <FavCompareDialog open={open} onClose={() => setOpen(false)} columns={columns} title="岗位对比" />
        )}
      </Suspense>
    </>
  )
}
