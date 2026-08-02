import { HOT_SEARCHES } from '@/lib/synonyms'

/** 空结果时的热门搜索词 pills，点击填入当前板块搜索框直搜。 */
export function HotSearchPills({ onPick }: { onPick: (word: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="text-xs text-muted-foreground">热门搜索</div>
      <div className="flex max-w-md flex-wrap justify-center gap-1.5">
        {HOT_SEARCHES.map((w) => (
          <button
            key={w}
            type="button"
            className="min-h-11 cursor-pointer rounded-full border bg-muted/50 px-3 py-1 text-xs text-foreground/80 transition-colors hover:bg-muted hover:text-foreground sm:min-h-7"
            onClick={() => onPick(w)}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  )
}
