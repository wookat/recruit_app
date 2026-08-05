import { t } from '@/lib/i18n'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Scale, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  BOARD_COMPARE_MAX,
  clearBoardCompare,
  clearBoardCompareHint,
  removeBoardCompare,
  toggleBoardCompare,
  useBoardCompare,
  useBoardCompareHint,
  type BoardCompareBoard,
  type BoardCompareItem,
} from '@/lib/boardCompare'
import type { FavCompareColumn } from './FavCompareDialog'
import { stripOrgPrefix } from '@/lib/orgPrefix'
import { lazyRetry } from '@/lib/lazyRetry'

const FavCompareDialog = lazy(() =>
  lazyRetry(() => import('./FavCompareDialog').then((m) => ({ default: m.FavCompareDialog }))),
)

const BOARD_NAMES: Record<BoardCompareBoard, string> = {
  positions: t("体制内"),
  campus: t("校招"),
  bianzhi: t("编制"),
}

/** 跨板块通用字段映射：三板块字段名不同，统一到同一组标签，缺失显示 —。 */
function unifiedFields(s: BoardCompareItem): { label: string; value: string }[] {
  const dash = '—'
  if (s.board === 'positions') {
    const j = s.job
    const major = [j.undergrad_major, j.grad_major].filter(Boolean).join(' / ')
    return [
      { label: t("来源板块"), value: BOARD_NAMES.positions },
      { label: t("单位"), value: j.employer || dash },
      { label: t("岗位"), value: j.position_example ? stripOrgPrefix(j.position_example, j.employer, j.exam_type_norm || j.exam_type) : dash },
      { label: t("工作地点"), value: j.work_location || dash },
      { label: t("学历要求"), value: j.edu_level_norm || j.edu_requirement || dash },
      { label: t("专业要求"), value: major || j.raw_major || dash },
      { label: t("截止/报名"), value: j.signup_deadline?.slice(0, 10) || j.signup_time || dash },
      { label: t("批次/类型"), value: j.exam_type || j.job_type || dash },
    ]
  }
  if (s.board === 'campus') {
    const j = s.job
    return [
      { label: t("来源板块"), value: BOARD_NAMES.campus },
      { label: t("单位"), value: j.company || dash },
      { label: t("岗位"), value: j.positions ? stripOrgPrefix(j.positions, j.company) : dash },
      { label: t("工作地点"), value: j.locations || dash },
      { label: t("学历要求"), value: j.edu_requirement || dash },
      { label: t("专业要求"), value: j.major_requirement || dash },
      { label: t("截止/报名"), value: j.deadline_text || dash },
      { label: t("批次/类型"), value: j.batch || j.industry || dash },
    ]
  }
  const j = s.job
  return [
    { label: t("来源板块"), value: BOARD_NAMES.bianzhi },
    { label: t("单位"), value: j.employer || dash },
    { label: t("岗位"), value: j.job_type ? stripOrgPrefix(j.job_type, j.employer) : dash },
    { label: t("工作地点"), value: j.work_location || j.province || dash },
    { label: t("学历要求"), value: j.edu_requirement || dash },
    { label: t("专业要求"), value: j.major_requirement || dash },
    { label: t("截止/报名"), value: j.deadline_text || dash },
    { label: t("批次/类型"), value: j.category || dash },
  ]
}

function itemTitle(s: BoardCompareItem): string {
  if (s.board === 'positions') return s.job.position_example || s.job.employer || `#${s.job.id}`
  if (s.board === 'campus') return s.job.company || `#${s.job.id}`
  return s.job.employer || s.job.category || `#${s.job.id}`
}

/** 跨板块对比浮条：体制内/校招/编制混合勾选 2-3 条，通用字段映射 + 差异高亮。 */
export function BoardCompareBar({
  onOpenJob,
}: {
  onOpenJob: (board: BoardCompareBoard, id: number) => void
}) {
  const items = useBoardCompare()
  const hint = useBoardCompareHint()
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

  const columns: FavCompareColumn[] = items.map((s) => ({
    key: `${s.board}-${s.job.id}`,
    title: itemTitle(s),
    badge: BOARD_NAMES[s.board],
    fields: unifiedFields(s),
    onRemove: () => removeBoardCompare(s.board, s.job.id),
    onOpenDetail: () => {
      setOpen(false)
      onOpenJob(s.board, s.job.id)
    },
  }))

  return (
    <>
      <div className="fixed inset-x-0 bottom-14 z-40 border-t bg-background/95 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] backdrop-blur md:bottom-0">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2.5">
          <Scale className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 text-sm font-medium">
            <span className="hidden sm:inline">{t("对比栏")}</span>（{items.length}/{BOARD_COMPARE_MAX}）
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {items.map((s) => (
              <Badge
                key={`${s.board}-${s.job.id}`}
                variant="secondary"
                className="max-w-[120px] gap-1 font-normal sm:max-w-[180px]"
              >
                <span className="truncate">{itemTitle(s)}</span>
                <button
                  type="button"
                  aria-label={t("移出对比")}
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
              {t("清空")}{' '}</Button>
            <Button size="sm" className="h-8" disabled={items.length < 2} onClick={() => setOpen(true)}>
              {t("开始对比")}{items.length < 2 ? t("（至少2条）") : ''}
            </Button>
          </div>
        </div>
      </div>
      <Suspense fallback={null}>
        {open && (
          <FavCompareDialog open={open} onClose={() => setOpen(false)} columns={columns} title={t("岗位对比")} />
        )}
      </Suspense>
    </>
  )
}
