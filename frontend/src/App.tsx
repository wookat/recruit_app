import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { fetchCampusJobs, fetchPosition, fetchPositions, type Position } from '@/api'
import { importFavorites } from '@/lib/positionStore'
import { PositionSheet } from '@/components/PositionSheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SearchPage } from '@/components/SearchPage'
import { Skeleton } from '@/components/ui/skeleton'
import { BookOpen, Briefcase, Moon, Settings, Star, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FavoritesSheet } from '@/components/FavoritesSheet'
import { CompareBar } from '@/components/CompareBar'
import { useFavorites } from '@/lib/positionStore'
import { useBianzhiFavorites, useCampusFavorites } from '@/lib/boardFavorites'
import { daysUntil, parseDeadlineText, parseSignupDeadline } from '@/lib/deadline'

const JobGuideSheet = lazy(() =>
  import('@/components/JobGuideSheet').then((m) => ({ default: m.JobGuideSheet })),
)

const AdminPage = lazy(() =>
  import('@/components/AdminPage').then((m) => ({ default: m.AdminPage })),
)
const CampusPage = lazy(() =>
  import('@/components/CampusPage').then((m) => ({ default: m.CampusPage })),
)
const BianzhiPage = lazy(() =>
  import('@/components/BianzhiPage').then((m) => ({ default: m.BianzhiPage })),
)

const showAdmin = new URLSearchParams(window.location.search).get('admin') === '1'

const CAMPUS_CROSS = [
  { key: 'all', label: '校招' },
  { key: 'noexam', label: '免笔试' },
  { key: 'referral', label: '内推码' },
  { key: 'intern', label: '实习' },
  { key: 'autumn', label: '秋招' },
  { key: 'bz:all', label: '编制公告' },
  { key: 'bz:edu', label: '教师招聘' },
  { key: 'bz:med', label: '医疗招聘' },
]

const POSITION_CROSS = [
  { key: 'all', label: '体制内全部' },
  { key: 'gwy', label: '公务员' },
  { key: 'sye', label: '事业编' },
  { key: 'jdwz', label: '军队文职' },
  { key: 'gqyq', label: '国企央企' },
  { key: 'xds', label: '选调生' },
  { key: 'bz:all', label: '编制公告' },
  { key: 'bz:edu', label: '教师招聘' },
  { key: 'bz:med', label: '医疗招聘' },
]

const BIANZHI_CROSS = [
  { key: 'pos:all', label: '体制内岗位' },
  { key: 'pos:gwy', label: '公务员' },
  { key: 'campus:all', label: '校招信息' },
  { key: 'campus:noexam', label: '免笔试' },
]

interface Section {
  mode: 'positions' | 'campus' | 'bianzhi'
  preset?: string
  keyword?: string
}

function initialSection(): Section {
  const q = new URLSearchParams(window.location.search)
  const board = q.get('board')
  if (board === 'campus' || board === 'bianzhi') {
    return { mode: board, preset: q.get('bpreset') || undefined }
  }
  return { mode: 'positions' }
}

function syncSectionUrl(section: Section) {
  const q = new URLSearchParams(window.location.search)
  if (section.mode === 'positions') {
    q.delete('board')
    q.delete('bpreset')
  } else {
    q.set('board', section.mode)
    if (section.preset) q.set('bpreset', section.preset)
    else q.delete('bpreset')
  }
  const qs = q.toString()
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
}

function getTheme(): 'light' | 'dark' | 'system' {
  try {
    const v = localStorage.getItem('recruit.theme')
    if (v === 'light' || v === 'dark') return v
  } catch {
    // ignore
  }
  return 'system'
}

function setTheme(v: 'light' | 'dark' | 'system') {
  try {
    if (v === 'system') localStorage.removeItem('recruit.theme')
    else localStorage.setItem('recruit.theme', v)
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event('recruit-theme-change'))
}

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
  const [section, setSection] = useState<Section>(initialSection)
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(getTheme)
  const [favOpen, setFavOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [deepLinked, setDeepLinked] = useState<Position | null>(null)
  const favorites = useFavorites()
  const campusFavorites = useCampusFavorites()
  const bianzhiFavorites = useBianzhiFavorites()
  const dueSoon = useMemo(() => {
    const within3 = (d: Date | null) => {
      if (!d) return false
      const n = daysUntil(d)
      return n >= 0 && n <= 3
    }
    return (
      favorites.filter((p) => within3(parseSignupDeadline(p))).length +
      campusFavorites.filter((j) => within3(parseDeadlineText(j.deadline_text))).length +
      bianzhiFavorites.filter((j) => within3(parseDeadlineText(j.deadline_text))).length
    )
  }, [favorites, campusFavorites, bianzhiFavorites])

  useEffect(() => {
    syncSectionUrl(section)
  }, [section])

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'system' ? 'dark' : prev === 'dark' ? 'light' : 'system'
      setTheme(next)
      return next
    })
  }, [])

  const goCampus = useCallback((preset?: string, keyword?: string) => {
    setSection({ mode: 'campus', preset, keyword })
    window.scrollTo({ top: 0 })
  }, [])
  const goPositions = useCallback((preset?: string, keyword?: string) => {
    setSection({ mode: 'positions', preset, keyword })
    window.scrollTo({ top: 0 })
  }, [])
  const goBianzhi = useCallback((preset?: string, keyword?: string) => {
    setSection({ mode: 'bianzhi', preset, keyword })
    window.scrollTo({ top: 0 })
  }, [])
  const campusTotal = useCallback(
    (kw: string) => fetchCampusJobs({ keyword: kw, page: 1, page_size: 1 }).then((r) => r.total),
    [],
  )
  const positionsTotal = useCallback(
    (kw: string) => fetchPositions({ keyword: kw, page: 1, page_size: 1 }).then((r) => r.total),
    [],
  )

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
                体制内岗位 · 校招信息 一站检索
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2"
            onClick={cycleTheme}
            title={theme === 'system' ? '主题：跟随系统' : theme === 'dark' ? '主题：暗色' : '主题：亮色'}
            aria-label="切换主题"
          >
            {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {theme === 'system' && <span className="hidden text-[11px] text-muted-foreground lg:inline">自动</span>}
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setGuideOpen(true)}>
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">求职攻略</span>
            <span className="sm:hidden">攻略</span>
          </Button>
          <Button variant="outline" size="sm" className="relative gap-1.5" onClick={() => setFavOpen(true)}>
            <Star className="h-4 w-4 text-amber-400" />
            我的收藏
            {dueSoon > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
                title={`${dueSoon} 个收藏岗位 3 天内截止`}
              >
                {dueSoon}
              </span>
            )}
            {favorites.length + campusFavorites.length + bianzhiFavorites.length > 0 && (
              <Badge variant="secondary" className="px-1.5 text-[11px]">
                {favorites.length + campusFavorites.length + bianzhiFavorites.length}
              </Badge>
            )}
          </Button>
          </div>
        </div>
        {showAdmin && (
          <div className="mx-auto max-w-7xl px-4 pb-3">
            <Tabs value={tab} onValueChange={setTab} className="w-full">
              <TabsList className="grid h-10 w-full max-w-xs grid-cols-2">
                <TabsTrigger value="search" className="gap-1.5">
                  <Briefcase className="h-4 w-4" />
                  岗位检索
                </TabsTrigger>
                <TabsTrigger value="admin" className="gap-1.5">
                  <Settings className="h-4 w-4" />
                  管理
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div key={tab === 'admin' ? 'admin' : section.mode} className="animate-fade-in-up">
          {tab !== 'admin' && section.mode === 'positions' && (
            <SearchPage
              key={`${section.preset ?? ''}|${section.keyword ?? ''}`}
              initialPresetKey={section.preset}
              initialKeyword={section.keyword}
              crossPresets={CAMPUS_CROSS}
              onCrossPreset={(k) => (k.startsWith('bz:') ? goBianzhi(k.slice(3)) : goCampus(k))}
              crossLabel="校招信息"
              crossFetchTotal={campusTotal}
              onCrossOpen={(kw) => goCampus('all', kw)}
            />
          )}
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            {tab !== 'admin' && section.mode === 'campus' && (
              <CampusPage
                key={`${section.preset ?? ''}|${section.keyword ?? ''}`}
                initialPreset={section.preset}
                initialKeyword={section.keyword}
                crossPresets={POSITION_CROSS}
                onCrossPreset={(k) => (k.startsWith('bz:') ? goBianzhi(k.slice(3)) : goPositions(k))}
                crossLabel="体制内岗位"
                crossFetchTotal={positionsTotal}
                onCrossOpen={(kw) => goPositions('all', kw)}
              />
            )}
            {tab !== 'admin' && section.mode === 'bianzhi' && (
              <BianzhiPage
                key={`${section.preset ?? ''}|${section.keyword ?? ''}`}
                initialPreset={section.preset}
                initialKeyword={section.keyword}
                crossPresets={BIANZHI_CROSS}
                onCrossPreset={(k) =>
                  k.startsWith('pos:') ? goPositions(k.slice(4)) : goCampus(k.slice(7))
                }
              />
            )}
            {tab === 'admin' && showAdmin && <AdminPage />}
          </Suspense>
        </div>
      </main>

      <footer className="border-t bg-background py-6 pb-16 text-center text-xs text-muted-foreground">
        数据来源：国家公务员局、军队人才网、国聘网及各省官方/汇总页面 · 仅供参考
      </footer>

      <FavoritesSheet open={favOpen} onClose={() => setFavOpen(false)} />
      <Suspense fallback={null}>
        {guideOpen && <JobGuideSheet open={guideOpen} onClose={() => setGuideOpen(false)} />}
      </Suspense>
      <CompareBar />
      {deepLinked && <PositionSheet item={deepLinked} onClose={() => setDeepLinked(null)} />}
    </div>
  )
}
