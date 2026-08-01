import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, MapPin, RefreshCw, Sparkles } from 'lucide-react'
import { fetchPositions, type Position } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FavoriteButton } from '@/components/FavoriteButton'
import { useFavorites } from '@/lib/positionStore'

const COLLAPSED_KEY = 'recruit.recoCollapsed'
const SHOW_COUNT = 5

function topBy(counts: Map<string, number>): string | null {
  let best: string | null = null
  let n = 0
  for (const [k, v] of counts) {
    if (v > n) {
      best = k
      n = v
    }
  }
  return best
}

/** 基于收藏岗位的省份+考试类型频次推荐未收藏岗位；无收藏时不渲染。 */
export function RecommendSection() {
  const favorites = useFavorites()
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === '1',
  )
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Position[] | null>(null)
  const [loading, setLoading] = useState(false)

  const basis = useMemo(() => {
    if (!favorites.length) return null
    const provs = new Map<string, number>()
    const types = new Map<string, number>()
    for (const p of favorites) {
      const prov = p.location_tags?.[0]
      if (prov) provs.set(prov, (provs.get(prov) ?? 0) + 1)
      if (p.exam_type) types.set(p.exam_type, (types.get(p.exam_type) ?? 0) + 1)
    }
    const province = topBy(provs)
    const examType = topBy(types)
    if (!province && !examType) return null
    return { province, examType }
  }, [favorites])

  const favIds = useMemo(() => new Set(favorites.map((p) => p.id)), [favorites])

  useEffect(() => {
    if (!basis || collapsed) return
    let cancelled = false
    setLoading(true)
    fetchPositions({
      province: basis.province ? [basis.province] : undefined,
      exam_type: basis.examType ? [basis.examType] : undefined,
      page,
      page_size: 12,
    })
      .then((res) => {
        if (cancelled) return
        const fresh = res.items.filter((p) => !favIds.has(p.id))
        if (!fresh.length && page > 1) {
          setPage(1)
          return
        }
        setItems(fresh.slice(0, SHOW_COUNT))
      })
      .catch(() => {
        if (!cancelled) setItems(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // 收藏变动不重拉，避免在推荐区收藏后卡片立刻消失
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis, page, collapsed])

  if (!basis) return null

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
      return !c
    })
  }

  const basisLabel = [basis.province, basis.examType].filter(Boolean).join(' · ')

  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium sm:min-h-0"
          onClick={toggle}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <Sparkles className="h-4 w-4 text-primary" />
          为你推荐
          <span className="text-xs font-normal text-muted-foreground">基于收藏（{basisLabel}）</span>
        </button>
        {!collapsed && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1 text-xs text-muted-foreground sm:min-h-0 sm:h-7"
            onClick={() => setPage((p) => p + 1)}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            换一批
          </Button>
        )}
      </div>
      {!collapsed && (
        <div className="scrollbar-none mt-3 flex gap-3 overflow-x-auto pb-1">
          {(items ?? []).map((p) => (
            <div
              key={p.id}
              className="flex w-60 shrink-0 flex-col gap-1.5 rounded-lg border bg-background p-3"
            >
              <div className="flex items-start justify-between gap-1">
                <span className="line-clamp-2 text-sm font-medium">{p.employer || p.position_example || '-'}</span>
                <FavoriteButton item={p} className="h-8 w-8 shrink-0 sm:h-7 sm:w-7" />
              </div>
              {p.position_example && (
                <span className="line-clamp-1 text-xs text-muted-foreground">{p.position_example}</span>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {p.exam_type && (
                  <Badge variant="secondary" className="border-0 px-1.5 py-0 text-[11px]">
                    {p.exam_type}
                  </Badge>
                )}
                {p.work_location && (
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="h-3 w-3" />
                    <span className="max-w-28 truncate">{p.work_location}</span>
                  </span>
                )}
              </div>
            </div>
          ))}
          {loading && !items?.length && (
            <div className="py-6 text-center text-xs text-muted-foreground">加载中…</div>
          )}
          {!loading && items && items.length === 0 && (
            <div className="py-6 text-center text-xs text-muted-foreground">暂无更多推荐</div>
          )}
        </div>
      )}
    </div>
  )
}
