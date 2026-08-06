import { t } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { CalendarDays, ClipboardList, LayoutGrid, SlidersHorizontal, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VALUE_PROP_DISMISSED_EVENT, valuePropPending } from '@/components/ValuePropBanner'

const SEEN_KEY = 'recruit.onboarded'

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

const STEPS = [
  {
    icon: LayoutGrid,
    title: t("① 三板块一站切换"),
    desc: t("体制内 / 校招 / 编制公告随时切换，顶栏日历看全站截止"),
    extraIcon: CalendarDays,
  },
  {
    icon: SlidersHorizontal,
    title: t("② 一键匹配与筛选保存"),
    desc: t("按专业学历地区快速匹配，常用筛选可保存为一键恢复"),
    extraIcon: null,
  },
  {
    icon: Star,
    title: t("③ 收藏 → 投递追踪"),
    desc: t("星标收藏岗位，记录投递状态与备注，截止自动提醒"),
    extraIcon: ClipboardList,
  },
]

/** 首次访问的一次性轻量引导卡（非阻断）；价值主张条展示期间避让，关闭/消费后才出现。 */
export function OnboardingCard({ onOpenTips }: { onOpenTips: () => void }) {
  const [visible, setVisible] = useState(() => !hasSeen() && !valuePropPending())

  useEffect(() => {
    const onDismiss = () => {
      if (!hasSeen()) setVisible(true)
    }
    window.addEventListener(VALUE_PROP_DISMISSED_EVENT, onDismiss)
    return () => window.removeEventListener(VALUE_PROP_DISMISSED_EVENT, onDismiss)
  }, [])

  if (!visible) return null

  const dismiss = () => {
    markSeen()
    setVisible(false)
  }

  return (
    <section className="relative mb-2 animate-fade-in-up rounded-xl border bg-gradient-to-br from-primary/5 to-transparent px-3 py-2 shadow-sm sm:mb-4 sm:p-5">
      <button
        type="button"
        aria-label={t("关闭引导")}
        className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:right-2 sm:top-2"
        onClick={dismiss}
      >
        <X className="h-4 w-4" />
      </button>
      {/* 移动端压缩为单行条（标题 + 技巧入口 + 关闭），保证 375px 首屏岗位卡可见 */}
      <div className="flex items-center gap-2 pr-8 sm:block sm:pr-10">
        <h2 className="min-w-0 flex-1 truncate text-xs font-bold sm:flex-none sm:text-sm">
          {t("👋 欢迎使用上岸雷达 · 3 步开始")}
        </h2>
        <button
          type="button"
          className="shrink-0 whitespace-nowrap text-xs text-primary underline-offset-2 hover:underline sm:hidden"
          onClick={() => {
            markSeen()
            setVisible(false)
            onOpenTips()
          }}
        >
          {t("使用技巧")}
        </button>
      </div>
      <div className="mt-3 hidden gap-3 sm:grid sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.title} className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <s.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold">{s.title}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 hidden flex-wrap items-center gap-2 sm:flex">
        <Button size="sm" className="min-h-8" onClick={dismiss}>
          {t("知道了")}{' '}</Button>
        <Button
          variant="outline"
          size="sm"
          className="min-h-8"
          onClick={() => {
            markSeen()
            setVisible(false)
            onOpenTips()
          }}
        >
          {t("查看使用技巧")}{' '}</Button>
      </div>
    </section>
  )
}
