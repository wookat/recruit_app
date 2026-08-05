import { tt } from '@/lib/i18n'
import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { ScatterChart, EffectScatterChart } from 'echarts/charts'
import { GeoComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { GeoJSONSourceInput } from 'echarts/types/src/coord/geo/geoTypes.js'
import chinaMap from '@/data/chinaMap.json'
import cityCoords from '@/data/cityCoords.json'

echarts.use([ScatterChart, EffectScatterChart, GeoComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])
echarts.registerMap('china', chinaMap as unknown as GeoJSONSourceInput)

const COORDS: Record<string, number[]> = cityCoords

interface Props {
  /** 城市 → 岗位数 */
  cities: Record<string, number>
  /** 点击城市气泡回调 */
  onSelectCity?: (city: string) => void
  /** 当前已选城市（高亮） */
  selected?: string[]
}

/** 岗位城市分布地图：气泡大小=岗位数，点击气泡应用城市筛选。 */
export function CityMapPanel({ cities, onSelectCity, selected }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
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
    if (!chart) return
    const data = Object.entries(cities)
      .filter(([c]) => COORDS[c])
      .map(([c, n]) => ({ name: c, value: [...COORDS[c], n] }))
    const max = Math.max(1, ...data.map((d) => d.value[2]))
    const selectedSet = new Set(selected ?? [])
    chart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: (p: { name: string; value: number[] }) =>
          tt`${p.name}：${p.value[2].toLocaleString()} 个岗位<br/><span style="font-size:11px;opacity:.7">点击筛选该城市</span>`,
      },
      geo: {
        map: 'china',
        roam: true,
        scaleLimit: { min: 1, max: 6 },
        zoom: 1.2,
        top: 10,
        itemStyle: {
          areaColor: isDark ? '#27272a' : '#f4f4f5',
          borderColor: isDark ? '#3f3f46' : '#d4d4d8',
        },
        emphasis: {
          disabled: true,
        },
        select: { disabled: true },
      },
      visualMap: {
        min: 0,
        max,
        show: false,
        seriesIndex: 0,
        inRange: { color: ['#93c5fd', '#2563eb'] },
        dimension: 2,
      },
      series: [
        {
          type: 'scatter',
          coordinateSystem: 'geo',
          data: data.filter((d) => !selectedSet.has(d.name)),
          symbolSize: (val: number[]) => 6 + 22 * Math.sqrt(val[2] / max),
          itemStyle: { opacity: 0.85 },
          cursor: 'pointer',
        },
        {
          type: 'effectScatter',
          coordinateSystem: 'geo',
          data: data.filter((d) => selectedSet.has(d.name)),
          symbolSize: (val: number[]) => 8 + 22 * Math.sqrt(val[2] / max),
          itemStyle: { color: '#dc2626' },
          cursor: 'pointer',
        },
      ],
    })
  }, [cities, selected, isDark])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onSelectCity) return
    const handler = (p: unknown) => {
      const params = p as { componentType?: string; name?: string }
      if (params.name && params.componentType === 'series') onSelectCity(params.name)
    }
    chart.on('click', handler)
    return () => {
      chart.off('click', handler)
    }
  }, [onSelectCity])

  return <div ref={ref} className="h-[420px] w-full sm:h-[520px]" />
}

export default CityMapPanel
