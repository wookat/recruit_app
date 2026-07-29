import { useMemo } from 'react'
import { MultiSelect, type OptionGroup } from './MultiSelect'
import type { FilterOptions } from '@/api'

interface LocationFilterProps {
  filters: FilterOptions | null
  value: string[]
  onChange: (value: string[]) => void
}

export function LocationFilter({ filters, value, onChange }: LocationFilterProps) {
  const locationTree = filters?.location_tree
  const provinceSet = new Set(filters?.provinces || [])
  const citySet = useMemo(() => {
    const set = new Set<string>()
    for (const node of locationTree || []) {
      for (const c of node.cities) set.add(c)
    }
    return set
  }, [locationTree])

  const selectedProvinces = value.filter((v) => provinceSet.has(v))
  const selectedCities = value.filter((v) => citySet.has(v))
  // 不在省/市集合中的视为区县（或兜底）
  const selectedDistricts = value.filter((v) => !provinceSet.has(v) && !citySet.has(v))

  const cityGroups: OptionGroup[] = useMemo(() => {
    const selectedProvinceSet = new Set(selectedProvinces)
    return (locationTree || [])
      .filter((node) => selectedProvinceSet.size === 0 || selectedProvinceSet.has(node.province))
      .map((node) => ({ label: node.province, options: node.cities }))
  }, [locationTree, selectedProvinces])

  if (!filters) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-9 w-full animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    )
  }

  const f = filters

  function handleProvinceChange(next: string[]) {
    // 省份变化时，过滤掉已选城市中不在当前省份下的城市（保留省份单独选择也生效）
    const allowed = new Set<string>()
    for (const node of f.location_tree) {
      if (next.length === 0 || next.includes(node.province)) {
        for (const c of node.cities) allowed.add(c)
      }
    }
    const keptCities = selectedCities.filter((c) => allowed.has(c))
    onChange([...new Set([...next, ...keptCities, ...selectedDistricts])])
  }

  function handleCityChange(next: string[]) {
    onChange([...new Set([...selectedProvinces, ...next, ...selectedDistricts])])
  }

  function handleDistrictChange(next: string[]) {
    onChange([...new Set([...selectedProvinces, ...selectedCities, ...next])])
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MultiSelect
        label="省份"
        options={f.provinces}
        selected={selectedProvinces}
        onChange={handleProvinceChange}
        placeholder="选择省份"
      />
      <MultiSelect
        label="城市"
        groups={cityGroups}
        selected={selectedCities}
        onChange={handleCityChange}
        placeholder={selectedProvinces.length === 0 ? '可先选省份' : '选择城市'}
      />
      <MultiSelect
        label="区县"
        options={f.districts}
        selected={selectedDistricts}
        onChange={handleDistrictChange}
        placeholder="选择区县"
      />
    </div>
  )
}
