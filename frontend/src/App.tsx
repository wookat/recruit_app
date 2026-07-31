import { lazy, Suspense, useEffect, useState } from 'react'
import { fetchPosition, type Position } from '@/api'
import { importFavorites } from '@/lib/positionStore'
import { PositionSheet } from '@/components/PositionSheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SearchPage } from '@/components/SearchPage'
import { Skeleton } from '@/components/ui/skeleton'
import { Briefcase, GraduationCap, Settings, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FavoritesSheet } from '@/components/FavoritesSheet'
import { CompareBar } from '@/components/CompareBar'
import { useFavorites } from '@/lib/positionStore'

const AdminPage = lazy(() =>
  import('@/components/AdminPage').then((m) => ({ default: m.AdminPage })),
)
const CampusPage = lazy(() =>
  import('@/components/CampusPage').then((m) => ({ default: m.CampusPage })),
)

const showAdmin = new URLSearchParams(window.location.search).get('admin') === '1'

function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="上岸罗盘">
      <defs>
        <linearGradient id="brand-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2563EB" />
          <stop offset="1" stopColor="#0891B2" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#brand-bg)" />
      <path d="M47 13 L23 29 L30 36 Z" fill="#FFFFFF" />
      <path d="M47 13 L30 36 L37 43 Z" fill="#FFFFFF" opacity="0.55" />
      <path
        d="M14 50 Q19 45.5 24 50 T34 50 T44 50 T54 50"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.5"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  )
}

export default function App() {
  const [tab, setTab] = useState(showAdmin ? 'admin' : 'search')
  const [favOpen, setFavOpen] = useState(false)
  const [deepLinked, setDeepLinked] = useState<Position | null>(null)
  const favorites = useFavorites()

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const positionId = Number(q.get('position_id'))
    if (positionId > 0) {
      fetchPosition(positionId).then(setDeepLinked).catch(console.error)
    }
    const favIds = (q.get('favorites') || '')
      .split(',')
      .map(Number)
      .filter((n) => n > 0)
      .slice(0, 50)
    if (favIds.length > 0) {
      Promise.allSettled(favIds.map(fetchPosition)).then((results) => {
        const items = results
          .filter((r): r is PromiseFulfilledResult<Position> => r.status === 'fulfilled')
          .map((r) => r.value)
        if (items.length > 0) {
          importFavorites(items)
          setFavOpen(true)
        }
      })
    }
  }, [])

  return (
    <div className="min-h-screen bg-muted/30 font-sans">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-9 w-9 shrink-0" />
            <div className="flex flex-col leading-none">
              <h1 className="text-lg font-bold tracking-tight">上岸罗盘</h1>
              <span className="mt-0.5 hidden text-[11px] tracking-widest text-muted-foreground sm:block">
                全国体制内岗位检索
              </span>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setFavOpen(true)}>
            <Star className="h-4 w-4 text-amber-400" />
            我的收藏
            {favorites.length > 0 && (
              <Badge variant="secondary" className="px-1.5 text-[11px]">
                {favorites.length}
              </Badge>
            )}
          </Button>
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-3">
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className={showAdmin ? 'grid h-10 w-full max-w-md grid-cols-3' : 'grid h-10 w-full max-w-xs grid-cols-2'}>
              <TabsTrigger value="search" className="gap-1.5">
                <Briefcase className="h-4 w-4" />
                体制内岗位
              </TabsTrigger>
              <TabsTrigger value="campus" className="gap-1.5">
                <GraduationCap className="h-4 w-4" />
                校招信息
              </TabsTrigger>
              {showAdmin && (
                <TabsTrigger value="admin" className="gap-1.5">
                  <Settings className="h-4 w-4" />
                  管理
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div key={tab} className="animate-fade-in-up">
          {tab === 'search' && <SearchPage />}
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            {tab === 'campus' && <CampusPage />}
            {tab === 'admin' && showAdmin && <AdminPage />}
          </Suspense>
        </div>
      </main>

      <footer className="border-t bg-background py-6 pb-16 text-center text-xs text-muted-foreground">
        数据来源：国家公务员局、军队人才网、国聘网及各省官方/汇总页面 · 仅供参考
      </footer>

      <FavoritesSheet open={favOpen} onClose={() => setFavOpen(false)} />
      <CompareBar />
      {deepLinked && <PositionSheet item={deepLinked} onClose={() => setDeepLinked(null)} />}
    </div>
  )
}
