import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { Button } from '@/components/ui/button'

echarts.use([BarChart, DataZoomComponent, GridComponent, TooltipComponent, CanvasRenderer])

interface Props {
  /** 更新日期（YYYY-MM-DD）→ 岗位数 */
  days: Record<string, number>
  /** 当前生效的时间段筛选 */
  range: { from: string; to: string } | null
  /** 应用所选时间段筛选 */
  onApplyRange: (from: string, to: string) => void
  /** 清除时间段筛选 */
  onClearRange: () => void
}

const DEFAULT_WINDOW_DAYS = 90

/** 岗位更新时间线：按日更新岗位数柱状图，下方滑块拖选时间段后应用筛选。 */
export function TimelinePanel({ days, range, onApplyRange, onClearRange }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const dates = useMemo(() => Object.keys(days).sort(), [days])
  const [window_, setWindow] = useState<{ from: string; to: string } | null>(null)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const el = document.documentElement
    const observer = new MutationObserver(() => setIsDark(el.classList.contains('dark')))
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chartRef.current = chart
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !dates.length) return
    const defaultStartIdx = Math.max(0, dates.length - DEFAULT_WINDOW_DAYS)
    const startIdx = range ? Math.max(0, dates.findIndex((d) => d >= range.from)) : defaultStartIdx
    const endIdx = range
      ? (() => {
          for (let i = dates.length - 1; i >= 0; i--) if (dates[i] <= range.to) return i
          return dates.length - 1
        })()
      : dates.length - 1
    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (ps: { name: string; value: number }[]) =>
          `${ps[0].name}：更新 ${ps[0].value.toLocaleString()} 个岗位`,
      },
      grid: { left: 44, right: 16, top: 16, bottom: 56 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: isDark ? '#a1a1aa' : '#71717a', fontSize: 10 },
        axisLine: { lineStyle: { color: isDark ? '#3f3f46' : '#d4d4d8' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: isDark ? '#a1a1aa' : '#71717a', fontSize: 10 },
        splitLine: { lineStyle: { color: isDark ? '#27272a' : '#f4f4f5' } },
      },
      dataZoom: [
        { type: 'slider', startValue: dates[startIdx], endValue: dates[endIdx], height: 24, bottom: 8 },
        { type: 'inside' },
      ],
      series: [
        {
          type: 'bar',
          data: dates.map((d) => days[d]),
          itemStyle: { color: '#2563eb', borderRadius: [2, 2, 0, 0] },
          large: true,
        },
      ],
    })
    setWindow({ from: dates[startIdx], to: dates[endIdx] })
  }, [dates, days, isDark, range])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const handler = () => {
      const opt = chart.getOption() as { dataZoom?: { startValue?: string | number; endValue?: string | number }[] }
      const dz = opt.dataZoom?.[0]
      if (dz == null) return
      const from = typeof dz.startValue === 'number' ? dates[dz.startValue] : dz.startValue
      const to = typeof dz.endValue === 'number' ? dates[dz.endValue] : dz.endValue
      if (from && to) setWindow({ from: String(from), to: String(to) })
    }
    chart.on('datazoom', handler)
    return () => {
      chart.off('datazoom', handler)
    }
  }, [dates])

  const windowTotal = useMemo(() => {
    if (!window_) return 0
    return dates.reduce((s, d) => (d >= window_.from && d <= window_.to ? s + days[d] : s), 0)
  }, [dates, days, window_])

  return (
    <div className="space-y-2">
      <div ref={ref} className="h-[240px] w-full sm:h-[280px]" />
      <div className="flex flex-wrap items-center gap-2 px-1 text-sm">
        {window_ && (
          <span className="text-muted-foreground">
            {window_.from} ~ {window_.to}：更新{' '}
            <span className="font-medium text-foreground">{windowTotal.toLocaleString()}</span> 个岗位
          </span>
        )}
        <Button
          size="sm"
          className="min-h-9 sm:min-h-8"
          disabled={!window_}
          onClick={() => window_ && onApplyRange(window_.from, window_.to)}
        >
          按该时间段筛选列表
        </Button>
        {range && (
          <Button variant="ghost" size="sm" className="min-h-9 sm:min-h-8" onClick={onClearRange}>
            清除时间段筛选
          </Button>
        )}
      </div>
    </div>
  )
}

export default TimelinePanel
