import { t } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { fetchPositionCompetition, type PositionCompetition } from '@/api'

const TTL = 60 * 60 * 1000
const cache = new Map<string, { at: number; data: PositionCompetition }>()

/** 竞争参考：同省+同考试类型+同年份岗位组横向数据，数据不足不渲染。 */
export function CompetitionRef({
  province,
  examType,
  year,
}: {
  province?: string | null
  examType?: string | null
  year: number
}) {
  const [data, setData] = useState<PositionCompetition | null>(null)

  useEffect(() => {
    setData(null)
    if (!province || !examType || !year) return
    const key = `${province}|${examType}|${year}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < TTL) {
      setData(hit.data)
      return
    }
    let cancelled = false
    fetchPositionCompetition(province, examType, year)
      .then((res) => {
        cache.set(key, { at: Date.now(), data: res })
        if (!cancelled) setData(res)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
    return () => {
      cancelled = true
    }
  }, [province, examType, year])

  if (!province || !examType || !data || data.total <= 1) return null

  const pct = Math.round((data.unlimited_major / data.total) * 100)

  return (
    <div className="flex items-start gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
      <BarChart3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <div className="text-xs font-medium text-muted-foreground">{t("竞争参考")}</div>
        <div className="mt-0.5 text-sm">
          {year} {' '}{t("年")}{province} · {examType} {' '}{t("同组岗位共")}{' '}
          <span className="font-semibold text-primary">{data.total.toLocaleString()}</span> {' '}{t("个")}{' '}{data.unlimited_major > 0 && (
            <>
              {t("，其中不限专业约")}{' '}<span className="font-semibold text-primary">{pct}%</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
