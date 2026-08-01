import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, MapPin, RefreshCw, Sparkles } from 'lucide-react'
import {
  fetchBianzhiJobs,
  fetchCampusJobs,
  type BianzhiJob,
  type CampusJob,
} from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BoardFavoriteButton } from '@/components/BoardFavoriteButton'
import {
  isBianzhiFavorite,
  isCampusFavorite,
  toggleBianzhiFavorite,
  toggleCampusFavorite,
  useBianzhiFavorites,
  useCampusFavorites,
} from '@/lib/boardFavorites'
import { useProfile } from '@/lib/profile'

const SHOW_COUNT = 6

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

function countTop<T>(items: T[], pick: (item: T) => string | null): string | null {
  const m = new Map<string, number>()
  for (const it of items) {
    const v = pick(it)
    if (v) m.set(v, (m.get(v) ?? 0) + 1)
  }
  return topBy(m)
}

interface Props {
  board: 'campus' | 'bianzhi'
  onOpenDetail?: (job: CampusJob | BianzhiJob) => void
}

/** 校招/编制「为你推荐」：基于画像或收藏偏好推荐未收藏岗位；两者皆空时不渲染。 */
export function BoardRecommendSection({ board, onOpenDetail }: Props) {
  const profile = useProfile()
  const campusFavs = useCampusFavorites()
  const bianzhiFavs = useBianzhiFavorites()
  const collapsedKey = `recruit.recoCollapsed.${board}`
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(collapsedKey) === '1',
  )
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<(CampusJob | BianzhiJob)[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const basis = useMemo(() => {
    const keyword = profile.major.trim() || null
    if (board === 'campus') {
      const city =
        profile.location[0] ??
        countTop(campusFavs, (j) => j.locations?.split(/[|,，、/\s]+/)[0]?.trim() || null)
      const kw = keyword ?? countTop(campusFavs, (j) => j.company_type)
      if (!city && !kw) return null
      return { place: city, keyword: kw }
    }
    const prov =
      profile.location[0] ?? countTop(bianzhiFavs, (j) => j.province)
    const kw = keyword ?? countTop(bianzhiFavs, (j) => j.category)
    if (!prov && !kw) return null
    return { place: prov, keyword: kw }
  }, [board, profile, campusFavs, bianzhiFavs])

  useEffect(() => {
    if (!basis || collapsed || failed) return
    let cancelled = false
    setLoading(true)
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), 10000)
    })
    const req =
      board === 'campus'
        ? fetchCampusJobs({
            keyword: basis.keyword ?? undefined,
            location: basis.place ?? undefined,
            page,
            page_size: 12,
          }).then((res) => res.items.filter((j) => !isCampusFavorite(j.id)))
        : fetchBianzhiJobs({
            keyword: basis.keyword ?? undefined,
            province: basis.place ? [basis.place] : undefined,
            page,
            page_size: 12,
          }).then((res) => res.items.filter((j) => !isBianzhiFavorite(j.id)))
    Promise.race([req, timeout])
      .then((fresh) => {
        if (cancelled) return
        if (!fresh.length && page > 1) {
          setPage(1)
          return
        }
        setItems(fresh.slice(0, SHOW_COUNT))
      })
      .catch(() => {
        if (!cancelled) {
          setItems(null)
          setFailed(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // 收藏变动不重拉，避免在推荐区收藏后卡片立刻消失
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, basis, page, collapsed, failed])

  if (!basis || failed) return null

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(collapsedKey, c ? '0' : '1')
      return !c
    })
  }

  const basisLabel = [basis.place, basis.keyword].filter(Boolean).join(' · ')
  const basisSource = profile.major.trim() || profile.location.length ? '基于画像' : '基于收藏'

  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-h-11 min-w-0 cursor-pointer items-center gap-1.5 text-sm font-medium sm:min-h-0"
          onClick={toggle}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" />
          )}
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 whitespace-nowrap">为你推荐</span>
          <span className="min-w-0 max-w-60 truncate text-xs font-normal text-muted-foreground">
            {basisSource}（{basisLabel}）
          </span>
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
          {(items ?? []).map((j) =>
            board === 'campus' ? (
              <CampusCard key={j.id} job={j as CampusJob} onOpen={onOpenDetail} />
            ) : (
              <BianzhiCard key={j.id} job={j as BianzhiJob} onOpen={onOpenDetail} />
            ),
          )}
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

function CampusCard({
  job,
  onOpen,
}: {
  job: CampusJob
  onOpen?: (job: CampusJob) => void
}) {
  const favs = useCampusFavorites()
  const active = favs.some((f) => f.id === job.id)
  return (
    <div
      className="flex w-60 shrink-0 cursor-pointer flex-col gap-1.5 rounded-lg border bg-background p-3 transition-colors hover:bg-muted/50"
      onClick={() => onOpen?.(job)}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="line-clamp-2 text-sm font-medium">{job.company || '-'}</span>
        <BoardFavoriteButton
          active={active}
          onToggle={() => toggleCampusFavorite(job)}
          className="h-8 w-8 shrink-0 sm:h-7 sm:w-7"
        />
      </div>
      {job.positions && (
        <span className="line-clamp-1 text-xs text-muted-foreground">{job.positions}</span>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {job.company_type && (
          <Badge variant="secondary" className="border-0 px-1.5 py-0 text-[11px]">
            {job.company_type.split(/\s*\|\s*/)[0]}
          </Badge>
        )}
        {job.locations && (
          <span className="inline-flex items-center gap-0.5">
            <MapPin className="h-3 w-3" />
            <span className="max-w-28 truncate">{job.locations}</span>
          </span>
        )}
      </div>
    </div>
  )
}

function BianzhiCard({
  job,
  onOpen,
}: {
  job: BianzhiJob
  onOpen?: (job: BianzhiJob) => void
}) {
  const favs = useBianzhiFavorites()
  const active = favs.some((f) => f.id === job.id)
  return (
    <div
      className="flex w-60 shrink-0 cursor-pointer flex-col gap-1.5 rounded-lg border bg-background p-3 transition-colors hover:bg-muted/50"
      onClick={() => onOpen?.(job)}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="line-clamp-2 text-sm font-medium">{job.employer || '-'}</span>
        <BoardFavoriteButton
          active={active}
          onToggle={() => toggleBianzhiFavorite(job)}
          className="h-8 w-8 shrink-0 sm:h-7 sm:w-7"
        />
      </div>
      {job.job_type && (
        <span className="line-clamp-1 text-xs text-muted-foreground">{job.job_type}</span>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {job.category && (
          <Badge variant="secondary" className="border-0 px-1.5 py-0 text-[11px]">
            {job.category}
          </Badge>
        )}
        {(job.work_location || job.province) && (
          <span className="inline-flex items-center gap-0.5">
            <MapPin className="h-3 w-3" />
            <span className="max-w-28 truncate">{job.work_location || job.province}</span>
          </span>
        )}
      </div>
    </div>
  )
}
