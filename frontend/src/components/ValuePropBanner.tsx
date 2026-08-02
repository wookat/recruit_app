import { useState } from 'react'
import { CalendarDays, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getProfile } from '@/lib/profile'

const SEEN_KEY = 'recruit.valuePropSeen'

function hasSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // ignore
  }
}

function hasAnyFavorite(): boolean {
  try {
    for (const key of ['recruit.favorites', 'recruit.campusFavorites', 'recruit.bianzhiFavorites']) {
      const raw = localStorage.getItem(key)
      if (raw && Array.isArray(JSON.parse(raw)) && (JSON.parse(raw) as unknown[]).length > 0) return true
    }
  } catch {
    // ignore
  }
  return false
}

function hasProfile(): boolean {
  const p = getProfile()
  return p.eduLevel.length > 0 || p.major.trim() !== '' || p.location.length > 0
}

/** 新访客一次性价值主张条：无收藏、无画像、未关闭过才显示。 */
export function ValuePropBanner({
  onMatch,
  onOpenUpdates,
}: {
  onMatch: () => void
  onOpenUpdates: () => void
}) {
  const [visible, setVisible] = useState(() => !hasSeen() && !hasAnyFavorite() && !hasProfile())
  if (!visible) return null

  const dismiss = () => {
    markSeen()
    setVisible(false)
  }

  return (
    <section className="relative mb-4 animate-fade-in-up rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
      <button
        type="button"
        aria-label="关闭价值主张条"
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:h-8 sm:w-8"
        onClick={dismiss}
      >
        <X className="h-4 w-4" />
      </button>
      <p className="pr-10 text-sm font-semibold">
        90 万+ 体制内 / 校招 / 编制岗位信息 · 每日自动更新 · 完全免费
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button
          size="sm"
          className="min-h-11 gap-1.5 sm:min-h-8"
          onClick={() => {
            dismiss()
            onMatch()
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          一键匹配我的条件
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 gap-1.5 sm:min-h-8"
          onClick={() => {
            dismiss()
            onOpenUpdates()
          }}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          看看今天新增
        </Button>
      </div>
    </section>
  )
}
