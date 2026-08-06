import { t } from '@/lib/i18n'
import { CalendarDays, Compass, GraduationCap, Home, Layers, SearchX } from 'lucide-react'

const ENTRIES = [
  { href: '/', icon: Compass, label: t('体制内岗位') },
  { href: '/?board=campus', icon: GraduationCap, label: t('校招信息') },
  { href: '/?board=all', icon: Layers, label: t('全部岗位') },
  { href: '/?board=calendar', icon: CalendarDays, label: t('截止日历') },
]

/** SPA 内 404 视图：未知路径时替代首页渲染，与 SSR 品牌化 404 页口径一致。 */
export function NotFoundPage() {
  return (
    <section className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <SearchX className="h-8 w-8" aria-hidden="true" />
      </span>
      <h1 className="text-xl font-bold">{t('页面不存在（404）')}</h1>
      <p className="text-sm text-muted-foreground">
        {t('你访问的页面不存在或已下线，可能是链接拼写有误。可以从下面的入口继续浏览岗位。')}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {ENTRIES.map((e) => (
          <a
            key={e.href}
            href={e.href}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted"
          >
            <e.icon className="h-4 w-4 text-primary" aria-hidden="true" />
            {e.label}
          </a>
        ))}
      </div>
      <a
        href="/"
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Home className="h-4 w-4" aria-hidden="true" />
        {t('返回上岸雷达首页')}
      </a>
    </section>
  )
}
