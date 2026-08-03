import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { fetchEmployerHistory, type EmployerHistoryYear } from '@/api'

const TTL = 60 * 60 * 1000
const cache = new Map<string, { at: number; data: EmployerHistoryYear[] }>()

/** 同单位历年岗位数：仅有 2 个及以上年份数据时渲染。 */
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
      <div>
        <div className="text-xs font-medium text-muted-foreground">该单位历年岗位数</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
          {years.map((y) => (
            <span key={y.year}>
              {y.year} 年{' '}
              <span className={y.year === currentYear ? 'font-semibold text-primary' : 'font-medium'}>
                {y.total.toLocaleString()}
              </span>{' '}
              条
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
