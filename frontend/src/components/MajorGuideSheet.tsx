import { useMemo, useState } from 'react'
import majorGuide from '@/data/majorGuide.json'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Search } from 'lucide-react'

interface MajorGuideEntry {
  major: string
  guide: string
}

const ENTRIES = majorGuide as MajorGuideEntry[]

export function MajorGuideSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<MajorGuideEntry | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return ENTRIES
    return ENTRIES.filter((e) => e.major.includes(q) || e.guide.includes(q))
  }, [query])

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>专业就业方向指南</SheetTitle>
          <SheetDescription>共 {ENTRIES.length} 个专业 · 按专业查看对口行业与岗位方向</SheetDescription>
        </SheetHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(null)
            }}
            placeholder="搜索专业，如：计算机 / 会计 / 机械…"
            className="h-10 pl-9"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected ? (
            <div className="space-y-3 pb-6">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-sm text-primary hover:underline"
              >
                ← 返回专业列表
              </button>
              <h3 className="text-base font-semibold">{selected.major}</h3>
              <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
                {selected.guide.split(/\s*\|\s*/).map((para, i) => (
                  <p key={i} className="whitespace-pre-wrap">
                    {para.trim()}
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 pb-6 pt-1">
              {filtered.map((e) => (
                <button key={e.major} type="button" onClick={() => setSelected(e)}>
                  <Badge
                    variant="secondary"
                    className="cursor-pointer px-2.5 py-1 text-xs transition-colors hover:bg-primary hover:text-primary-foreground"
                  >
                    {e.major}
                  </Badge>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground">没有匹配的专业</p>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
