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
    title: '① 三板块一站切换',
    desc: '体制内 / 校招 / 编制公告随时切换，顶栏日历看全站截止',
    extraIcon: CalendarDays,
  },
  {
    icon: SlidersHorizontal,
    title: '② 一键匹配与筛选保存',
    desc: '按专业学历地区快速匹配，常用筛选可保存为一键恢复',
    extraIcon: null,
  },
  {
    icon: Star,
    title: '③ 收藏 → 投递追踪',
    desc: '星标收藏岗位，记录投递状态与备注，截止自动提醒',
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
    <section className="relative mb-4 animate-fade-in-up rounded-xl border bg-gradient-to-br from-primary/5 to-transparent p-4 shadow-sm sm:p-5">
      <button
        type="button"
        aria-label="关闭引导"
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:h-8 sm:w-8"
        onClick={dismiss}
      >
        <X className="h-4 w-4" />
      </button>
      <h2 className="pr-10 text-sm font-bold">👋 欢迎使用上岸雷达 · 3 步开始</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" className="min-h-11 sm:min-h-8" onClick={dismiss}>
          知道了
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-8"
          onClick={() => {
            markSeen()
            setVisible(false)
            onOpenTips()
          }}
        >
          查看使用技巧
        </Button>
      </div>
    </section>
  )
}
