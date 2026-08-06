import { t } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { fetchEmployerHistory, type EmployerHistoryYear } from '@/api'

const TTL = 60 * 60 * 1000
const cache = new Map<string, { at: number; data: EmployerHistoryYear[] }>()

function eduSummary(y: EmployerHistoryYear): string {
  if (!y.edu || y.edu.length === 0) return ''
  return y.edu.map((e) => `${e.level} ${e.count}`).join(' · ')
}

/** 该单位历年招录：库内各年份岗位数与学历要求分布，仅有 2 个及以上年份数据时渲染。 */
export function EmployerHistory({ employer, currentYear }: { employer?: string | null; currentYear?: number }) {
  const [years, setYears] = useState<EmployerHistoryYear[]>([])

  const emp = employer?.trim()
  useEffect(() => {
    setYears([])
    if (!emp || emp.length < 2) return
    const hit = cache.get(emp)
    if (hit && Date.now() - hit.at < TTL) {
      setYears(hit.data)
      return
    }
    let cancelled = false
    fetchEmployerHistory(emp)
      .then((res) => {
        cache.set(emp, { at: Date.now(), data: res })
        if (!cancelled) setYears(res)
      })
      .catch(() => {
        if (!cancelled) setYears([])
      })
    return () => {
      cancelled = true
    }
  }, [emp])

  if (!emp || years.length < 2) return null

  return (
    <div className="flex items-start gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
      <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{t("该单位历年招录")}</div>
        <div className="mt-0.5 space-y-0.5 text-sm">
          {years.map((y) => {
            const edu = eduSummary(y)
            return (
              <div key={y.year} className="flex flex-wrap items-baseline gap-x-2">
                <span>
                  {y.year} {' '}{t("年")}{' '}
                  <span className={y.year === currentYear ? 'font-semibold text-primary' : 'font-medium'}>
                    {y.total.toLocaleString()}
                  </span>{' '}
                  {t("条")}{' '}</span>
                {edu && <span className="text-xs text-muted-foreground">{edu}</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
