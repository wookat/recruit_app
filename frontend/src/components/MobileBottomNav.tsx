import { BookOpen, Briefcase, CalendarDays, Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  active: 'jobs' | 'calendar' | null
  favCount: number
  dueSoon: number
  onJobs: () => void
  onCalendar: () => void
  onFavorites: () => void
  onGuide: () => void
}

/** 移动端（<768px）底部导航栏：岗位 / 日历 / 收藏 / 攻略。 */
export function MobileBottomNav({
  active,
  favCount,
  dueSoon,
  onJobs,
  onCalendar,
  onFavorites,
  onGuide,
}: Props) {
  const itemClass = (isActive: boolean) =>
    cn(
      'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors',
      isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
    )
  return (
    <nav
      aria-label="底部导航"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="flex items-stretch">
        <button type="button" className={itemClass(active === 'jobs')} onClick={onJobs} aria-current={active === 'jobs' ? 'page' : undefined}>
          <Briefcase className="h-5 w-5" />
          岗位
        </button>
        <button type="button" className={itemClass(active === 'calendar')} onClick={onCalendar} aria-current={active === 'calendar' ? 'page' : undefined}>
          <CalendarDays className="h-5 w-5" />
          日历
        </button>
        <button type="button" className={itemClass(false)} onClick={onFavorites}>
          <span className="relative">
            <Star className="h-5 w-5" />
            {favCount > 0 && (
              <span
                className={cn(
                  'absolute -right-2.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                  dueSoon > 0 ? 'bg-red-500 text-white' : 'bg-muted text-muted-foreground',
                )}
              >
                {dueSoon > 0 ? dueSoon : favCount}
              </span>
            )}
          </span>
          收藏
        </button>
        <button type="button" className={itemClass(false)} onClick={onGuide}>
          <BookOpen className="h-5 w-5" />
          攻略
        </button>
      </div>
    </nav>
  )
}
