import { t } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { BarChart3, Flame } from 'lucide-react'
import {
  fetchPositionCompetition,
  fetchPositionHeat,
  type PositionCompetition,
  type PositionHeat,
} from '@/api'

const TTL = 60 * 60 * 1000
const cache = new Map<string, { at: number; data: PositionCompetition }>()

const HEAT_TTL = 10 * 60 * 1000
const heatCache = new Map<number, { at: number; data: PositionHeat }>()

const HEAT_STYLE: Record<'high' | 'mid' | 'low', string> = {
  high: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300',
  mid: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300',
  low: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300',
}

const HEAT_LABEL: Record<'high' | 'mid' | 'low', string> = {
  high: '竞争热度 高',
  mid: '竞争热度 中',
  low: '竞争热度 低',
}

/** 竞争参考：同省+同考试类型+同年份岗位组横向数据，叠加站内浏览热度分位；数据不足不渲染。 */
export function CompetitionRef({
  positionId,
  province,
  examType,
  year,
}: {
  positionId?: number
  province?: string | null
  examType?: string | null
  year: number
}) {
  const [data, setData] = useState<PositionCompetition | null>(null)
  const [heat, setHeat] = useState<PositionHeat | null>(null)

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

  useEffect(() => {
    setHeat(null)
    if (!positionId) return
    const hit = heatCache.get(positionId)
    if (hit && Date.now() - hit.at < HEAT_TTL) {
      setHeat(hit.data)
      return
    }
    let cancelled = false
    fetchPositionHeat(positionId)
      .then((res) => {
        heatCache.set(positionId, { at: Date.now(), data: res })
        if (!cancelled) setHeat(res)
      })
      .catch(() => {
        if (!cancelled) setHeat(null)
      })
    return () => {
      cancelled = true
    }
  }, [positionId])

  if (!province || !examType || !data || data.total <= 1) return null

  const pct = Math.round((data.unlimited_major / data.total) * 100)
  const level = heat?.sample_ok ? heat.level : null

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
        {heat && (
          level && heat.percentile != null ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${HEAT_STYLE[level]}`}
              >
                <Flame className="h-3 w-3" aria-hidden="true" />
                {t(HEAT_LABEL[level])}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("该岗近 7 日浏览热度超过")}{' '}
                <span className="font-semibold">{heat.percentile}%</span> {' '}{t("的同类岗位")}
              </span>
            </div>
          ) : (
            <div className="mt-1.5 text-xs text-muted-foreground">
              {t("竞争热度：数据积累中，同类样本足够后展示")}
            </div>
          )
        )}
      </div>
    </div>
  )
}
