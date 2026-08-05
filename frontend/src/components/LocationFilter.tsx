import { t } from '@/lib/i18n'
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

  const districtGroups: OptionGroup[] | null = useMemo(() => {
    const tree = filters?.district_tree
    if (!tree || tree.length === 0) return null
    const provSet = new Set(selectedProvinces)
    const citySel = new Set(selectedCities)
    const nodes = tree.filter(
      (n) =>
        (provSet.size === 0 || provSet.has(n.province)) &&
        (citySel.size === 0 || citySel.has(n.city)),
    )
    return nodes.map((n) => ({ label: `${n.province} · ${n.city}`, options: n.districts }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters?.district_tree, value])

  if (!filters) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-9 w-full animate-pulse rounded-lg bg-muted" />
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
    // 选中城市后自动取消其所属省份（避免省+市并集导致计数不收窄）
    const added = next.filter((c) => !selectedCities.includes(c))
    const dropProvs = new Set<string>()
    for (const node of f.location_tree) {
      if (added.some((c) => node.cities.includes(c))) dropProvs.add(node.province)
    }
    const keptProvs = selectedProvinces.filter((p) => !dropProvs.has(p))
    onChange([...new Set([...keptProvs, ...next, ...selectedDistricts])])
  }

  function handleDistrictChange(next: string[]) {
    // 选中区县后自动取消其所属省/市
    const added = next.filter((d) => !selectedDistricts.includes(d))
    const dropProvs = new Set<string>()
    const dropCities = new Set<string>()
    for (const n of f.district_tree || []) {
      if (added.some((d) => n.districts.includes(d))) {
        dropProvs.add(n.province)
        dropCities.add(n.city)
      }
    }
    const keptProvs = selectedProvinces.filter((p) => !dropProvs.has(p))
    const keptCities = selectedCities.filter((c) => !dropCities.has(c))
    onChange([...new Set([...keptProvs, ...keptCities, ...next])])
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MultiSelect
        label={t("省份")}
        options={f.provinces}
        selected={selectedProvinces}
        onChange={handleProvinceChange}
        placeholder={t("选择省份")}
      />
      <MultiSelect
        label={t("城市")}
        groups={cityGroups}
        selected={selectedCities}
        onChange={handleCityChange}
        placeholder={selectedProvinces.length === 0 ? t("可先选省份") : t("选择城市")}
      />
      <MultiSelect
        label={t("区县")}
        options={districtGroups ? undefined : f.districts}
        groups={districtGroups || undefined}
        selected={selectedDistricts}
        onChange={handleDistrictChange}
        placeholder={selectedProvinces.length === 0 && selectedCities.length === 0 ? t("可先选省份/城市") : t("选择区县")}
      />
    </div>
  )
}
