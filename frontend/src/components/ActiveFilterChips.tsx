import { X } from 'lucide-react'

export interface RemovableFilter {
  label: string
  onRemove: () => void
}

/** 列表上方的已选筛选摘要条：可删除 chips + 清除全部，空时不渲染。 */
export function FilterSummaryBar({
  filters,
  onClearAll,
}: {
  filters: RemovableFilter[]
  onClearAll: () => void
}) {
  if (filters.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border bg-muted/30 px-3 py-2">
      <span className="text-xs text-muted-foreground">已选筛选：</span>
      {filters.map((f) => (
        <button
          key={f.label}
          type="button"
          onClick={f.onRemove}
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive sm:min-h-0"
        >
          {f.label}
          <X className="h-3 w-3" />
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-auto inline-flex min-h-11 items-center rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-destructive hover:underline sm:min-h-0"
      >
        清除全部
      </button>
    </div>
  )
}

/** 空结果提示中的生效筛选 chips，点击单个移除。 */
export function ActiveFilterChips({ filters }: { filters: RemovableFilter[] }) {
  if (filters.length === 0) return null
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-xs text-muted-foreground">已选筛选（点击移除）：</div>
      <div className="flex max-w-md flex-wrap justify-center gap-1.5">
        {filters.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={f.onRemove}
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive sm:min-h-0"
          >
            {f.label}
            <X className="h-3 w-3" />
          </button>
        ))}
      </div>
    </div>
  )
}
