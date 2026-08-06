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
    <section className="relative mb-3 animate-fade-in-up rounded-xl border bg-gradient-to-br from-primary/5 to-transparent p-3 shadow-sm sm:mb-4 sm:p-5">
      <button
        type="button"
        aria-label={t("关闭引导")}
        className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:right-2 sm:top-2 sm:h-8 sm:w-8"
        onClick={dismiss}
      >
        <X className="h-4 w-4" />
      </button>
      <h2 className="pr-10 text-sm font-bold">{t("👋 欢迎使用上岸雷达 · 3 步开始")}</h2>
      {/* 移动端压缩为一行摘要，保证 375px 首屏至少可见 1 张完整岗位卡 */}
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:hidden">
        {t("切换三板块 → 一键匹配筛选 → 收藏追踪与截止提醒")}
      </p>
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
      <div className="mt-2 flex flex-wrap items-center gap-2 sm:mt-3">
        <Button size="sm" className="min-h-9 sm:min-h-8" onClick={dismiss}>
          {t("知道了")}{' '}</Button>
        <Button
          variant="outline"
          size="sm"
          className="min-h-9 sm:min-h-8"
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
