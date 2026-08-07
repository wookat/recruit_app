import { t } from '@/lib/i18n'
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

/** 价值主张条是否待展示（首屏同时只留一张卡，引导卡据此避让）。 */
export function valuePropPending(): boolean {
  return !hasSeen() && !hasAnyFavorite() && !hasProfile()
}

export const VALUE_PROP_DISMISSED_EVENT = 'recruit:valuePropDismissed'

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
    window.dispatchEvent(new Event(VALUE_PROP_DISMISSED_EVENT))
  }

  return (
    <section className="relative animate-fade-in-up rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-3 py-1.5 sm:mb-4 sm:p-4">
      <button
        type="button"
        aria-label={t("关闭价值主张条")}
        className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:right-2 sm:top-2"
        onClick={dismiss}
      >
        <X className="h-4 w-4" />
      </button>
      {/* 移动端压缩为单行条（标题 + 匹配入口 + 关闭），保证 375px 首屏岗位卡可见 */}
      <div className="flex items-center gap-2 pr-8 sm:block sm:pr-10">
        <p className="min-w-0 flex-1 truncate text-xs font-semibold sm:flex-none sm:text-sm">
          {t("90 万+ 体制内 / 校招 / 编制岗位信息 · 每日自动更新 · 完全免费")}{' '}</p>
        <button
          type="button"
          className="shrink-0 whitespace-nowrap text-xs text-primary underline-offset-2 hover:underline sm:hidden"
          onClick={() => {
            dismiss()
            onMatch()
          }}
        >
          {t("一键匹配")}
        </button>
      </div>
      <div className="mt-2.5 hidden flex-wrap gap-2 sm:flex">
        <Button
          size="sm"
          className="min-h-11 gap-1.5 sm:min-h-8"
          onClick={() => {
            dismiss()
            onMatch()
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t("一键匹配我的条件")}{' '}</Button>
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
          {t("看看今天新增")}{' '}</Button>
      </div>
    </section>
  )
}
