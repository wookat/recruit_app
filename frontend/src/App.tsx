import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { fetchCampusJobs, fetchPosition, fetchPositions, type Position } from '@/api'
import { importFavorites } from '@/lib/positionStore'
import { LazyPositionSheet } from '@/components/LazyPositionSheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SearchPage } from '@/components/SearchPage'
import { Skeleton } from '@/components/ui/skeleton'
import { BookOpen, Briefcase, CalendarDays, History, Moon, Search, Settings, Sparkles, Star, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { CompareBar } from '@/components/CompareBar'
import { BoardCompareBar } from '@/components/BoardCompareBar'
import { MobileBottomNav } from '@/components/MobileBottomNav'
import { OnboardingCard } from '@/components/OnboardingCard'
import { useFavorites } from '@/lib/positionStore'
import { useBianzhiFavorites, useCampusFavorites } from '@/lib/boardFavorites'
import type { QuickFilter, SearchBoard } from '@/components/GlobalSearch'
import { applySeo } from '@/lib/seo'
import { readJobParam, setJobParam } from '@/lib/jobDeepLink'
import { POSITION_URL_KEYS } from '@/lib/urlFilters'
import { daysUntil, getEffectiveDeadline, parseSignupDeadline } from '@/lib/deadline'
import { useRemindDays } from '@/lib/reminderPref'
import { maybeNotifyDue } from '@/lib/dueNotification'
import { refreshSavedNews, useSavedNews } from '@/lib/savedNews'
import { lazyRetry } from '@/lib/lazyRetry'

const JobGuideSheet = lazy(() =>
  lazyRetry(() => import('@/components/JobGuideSheet').then((m) => ({ default: m.JobGuideSheet }))),
)

const GUIDE_SECTION_KEYS = ['mindset', 'resume', 'interview', 'timeline', 'biancal', 'company', 'choose', 'tips', 'examcal', 'about']

const GlobalSearch = lazy(() =>
  lazyRetry(() => import('@/components/GlobalSearch').then((m) => ({ default: m.GlobalSearch }))),
)
const FavoritesSheet = lazy(() =>
  lazyRetry(() => import('@/components/FavoritesSheet').then((m) => ({ default: m.FavoritesSheet }))),
)
const ViewHistorySheet = lazy(() =>
  lazyRetry(() => import('@/components/ViewHistorySheet').then((m) => ({ default: m.ViewHistorySheet }))),
)
const AdminPage = lazy(() =>
  lazyRetry(() => import('@/components/AdminPage').then((m) => ({ default: m.AdminPage }))),
)
const CampusPage = lazy(() =>
  lazyRetry(() => import('@/components/CampusPage').then((m) => ({ default: m.CampusPage }))),
)
const BianzhiPage = lazy(() =>
  lazyRetry(() => import('@/components/BianzhiPage').then((m) => ({ default: m.BianzhiPage }))),
)
const CalendarPage = lazy(() =>
  lazyRetry(() => import('@/components/CalendarPage').then((m) => ({ default: m.CalendarPage }))),
)
const RecentUpdatesPage = lazy(() =>
  lazyRetry(() => import('@/components/RecentUpdatesPage').then((m) => ({ default: m.RecentUpdatesPage }))),
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
  mode: 'positions' | 'campus' | 'bianzhi' | 'calendar' | 'updates'
  preset?: string
  keyword?: string
}

function initialSection(): Section {
  const q = new URLSearchParams(window.location.search)
  const board = q.get('board')
  if (board === 'campus' || board === 'bianzhi') {
    return { mode: board, preset: q.get('bpreset') || undefined }
  }
  if (board === 'calendar') return { mode: 'calendar' }
  if (board === 'updates') return { mode: 'updates' }
  return { mode: 'positions' }
}

function syncSectionUrl(section: Section) {
  const q = new URLSearchParams(window.location.search)
  if (section.mode === 'positions') {
    if (q.get('board')) q.delete('hexp')
    q.delete('board')
    q.delete('bpreset')
    q.delete('due')
    q.delete('city')
    q.delete('ctype')
    q.delete('prov')
    q.delete('bkw')
    q.delete('cview')
    q.delete('ub')
  } else if (section.mode === 'calendar' || section.mode === 'updates') {
    q.set('board', section.mode)
    for (const k of ['bpreset', 'due', 'city', 'ctype', 'prov', 'bkw', 'hexp']) q.delete(k)
    if (section.mode === 'updates') {
      q.delete('cview')
      q.delete('cboard')
    } else {
      q.delete('ub')
    }
    for (const k of POSITION_URL_KEYS) q.delete(k)
  } else {
    if (q.get('board') !== section.mode) q.delete('hexp')
    q.set('board', section.mode)
    q.delete('cview')
    q.delete('ub')
    for (const k of POSITION_URL_KEYS) {
      if (k !== 'hexp') q.delete(k)
    }
    if (section.preset) q.set('bpreset', section.preset)
    else q.delete('bpreset')
    if (section.mode === 'campus') q.delete('prov')
    else {
      q.delete('city')
      q.delete('ctype')
    }
  }
  const qs = q.toString()
  window.history.replaceState(
    null,
    '',
    (qs ? `?${qs}` : window.location.pathname) + window.location.hash,
  )
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
  const [historyOpen, setHistoryOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [deepLinked, setDeepLinked] = useState<Position | null>(null)
  const [posEduLevel, setPosEduLevel] = useState<string[] | undefined>(undefined)
  const [posQuick, setPosQuick] = useState<QuickFilter | undefined>(undefined)
  const [boardQuickNonce, setBoardQuickNonce] = useState(0)
  const favorites = useFavorites()
  const campusFavorites = useCampusFavorites()
  const bianzhiFavorites = useBianzhiFavorites()
  const remindDays = useRemindDays()
  const dueSoon = useMemo(() => {
    const within = (d: Date | null) => {
      if (!d) return false
      const n = daysUntil(d)
      return n >= 0 && n <= remindDays
    }
    return (
      favorites.filter((p) => within(parseSignupDeadline(p))).length +
      campusFavorites.filter((j) => within(getEffectiveDeadline(j))).length +
      bianzhiFavorites.filter((j) => within(getEffectiveDeadline(j))).length
    )
  }, [favorites, campusFavorites, bianzhiFavorites, remindDays])

  useEffect(() => {
    syncSectionUrl(section)
    applySeo(section.mode, section.preset)
  }, [section])

  useEffect(() => {
    const h = window.location.hash.slice(1)
    if (GUIDE_SECTION_KEYS.includes(h)) setGuideOpen(true)
  }, [])

  useEffect(() => {
    maybeNotifyDue(dueSoon, remindDays, () => setFavOpen(true))
  }, [dueSoon, remindDays])

  const savedNews = useSavedNews()
  useEffect(() => {
    refreshSavedNews()
  }, [])

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'system' ? 'dark' : prev === 'dark' ? 'light' : 'system'
      setTheme(next)
      return next
    })
  }, [])

  const clearBoardParams = useCallback(() => {
    const q = new URLSearchParams(window.location.search)
    for (const k of ['city', 'ctype', 'prov', 'bkw']) q.delete(k)
    const qs = q.toString()
    window.history.replaceState(
      null,
      '',
      (qs ? `?${qs}` : window.location.pathname) + window.location.hash,
    )
  }, [])
  const goCampus = useCallback(
    (preset?: string, keyword?: string) => {
      clearBoardParams()
      setSection({ mode: 'campus', preset, keyword })
      window.scrollTo({ top: 0 })
    },
    [clearBoardParams],
  )
  const goPositions = useCallback(
    (preset?: string, keyword?: string, eduLevel?: string[]) => {
      clearBoardParams()
      setPosEduLevel(eduLevel)
      setPosQuick(undefined)
      setSection({ mode: 'positions', preset, keyword })
      window.scrollTo({ top: 0 })
    },
    [clearBoardParams],
  )
  const goBianzhi = useCallback(
    (preset?: string, keyword?: string) => {
      clearBoardParams()
      setSection({ mode: 'bianzhi', preset, keyword })
      window.scrollTo({ top: 0 })
    },
    [clearBoardParams],
  )
  const campusTotal = useCallback(
    (kw: string) => fetchCampusJobs({ keyword: kw, page: 1, page_size: 1 }).then((r) => r.total),
    [],
  )
  const positionsTotal = useCallback(
    (kw: string) => fetchPositions({ keyword: kw, page: 1, page_size: 1 }).then((r) => r.total),
    [],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openSearchBoard = useCallback(
    (board: SearchBoard, kw: string) => {
      if (board === 'positions') goPositions('all', kw || undefined)
      else if (board === 'campus') goCampus('all', kw || undefined)
      else goBianzhi('all', kw || undefined)
    },
    [goPositions, goCampus, goBianzhi],
  )
  const openBoardKw = useCallback(
    (board: 'positions' | 'campus' | 'bianzhi', kw: string) => {
      if (board === 'positions') goPositions('all', kw || undefined)
      else if (board === 'campus') goCampus('all', kw || undefined)
      else goBianzhi('all', kw || undefined)
    },
    [goPositions, goCampus, goBianzhi],
  )

  /** 全站搜索快捷筛选：带省份/城市筛选直达对应板块 */
  const quickFilter = useCallback(
    (board: SearchBoard, filter: QuickFilter, kw: string) => {
      clearBoardParams()
      if (board === 'positions') {
        setPosEduLevel(undefined)
        setPosQuick(filter)
        setSection({ mode: 'positions', preset: 'all', keyword: kw || undefined })
        window.scrollTo({ top: 0 })
        return
      }
      const q = new URLSearchParams(window.location.search)
      if (board === 'bianzhi' && filter.province) q.set('prov', filter.province)
      if (board === 'campus' && filter.city) q.set('city', filter.city)
      window.history.replaceState(null, '', `?${q.toString()}${window.location.hash}`)
      setBoardQuickNonce((n) => n + 1)
      setSection({ mode: board, preset: 'all', keyword: kw || undefined })
      window.scrollTo({ top: 0 })
    },
    [clearBoardParams],
  )

  const openSearchJob = useCallback(
    (board: SearchBoard, id: number, kw: string) => {
      if (board === 'positions') {
        goPositions('all', kw || undefined)
        fetchPosition(id)
          .then(setDeepLinked)
          .catch(() => undefined)
        return
      }
      if (board === 'campus') goCampus('all', kw || undefined)
      else goBianzhi('all', kw || undefined)
      setJobParam(`${board}:${id}`)
      setBoardQuickNonce((n) => n + 1)
    },
    [goPositions, goCampus, goBianzhi],
  )


  useEffect(() => {
    const prefetch = () => {
      void import('@/components/GlobalSearch')
      void import('@/components/FavoritesSheet')
      void import('@/components/PositionSheet')
    }
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prefetch, { timeout: 5000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = setTimeout(prefetch, 3000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const positionId = Number(q.get('position_id')) || readJobParam('positions') || 0
    if (positionId > 0) {
      fetchPosition(positionId)
        .then(setDeepLinked)
        .catch(() => undefined)
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
    <div className="flex min-h-screen flex-col bg-muted/30 font-sans">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-9 w-9 shrink-0" />
            <div className="flex flex-col leading-none">
              <h1 className="whitespace-nowrap text-lg font-bold tracking-tight">上岸罗盘</h1>
              <span className="mt-0.5 hidden text-[11px] tracking-widest text-muted-foreground sm:block">
                体制内岗位 · 校招信息 一站检索
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="relative min-h-11 gap-1.5 px-2 sm:min-h-8"
            aria-label="全站搜索"
            title="全站搜索（Ctrl K）"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-4 w-4" />
            {savedNews.sum > 0 && (
              <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-red-500" aria-label="常用筛选有上新" />
            )}
            <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/80 lg:inline">
              Ctrl K
            </kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11 gap-1.5 px-2 sm:min-h-8 sm:min-w-0"
            onClick={cycleTheme}
            title={theme === 'system' ? '主题：跟随系统' : theme === 'dark' ? '主题：暗色' : '主题：亮色'}
            aria-label="切换主题"
          >
            {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {theme === 'system' && <span className="hidden text-[11px] text-muted-foreground lg:inline">自动</span>}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`hidden min-h-11 gap-1.5 px-2 sm:min-h-8 md:inline-flex ${section.mode === 'updates' ? 'text-primary' : ''}`}
            aria-label="今日更新"
            title="近 7 天新增岗位"
            onClick={() => {
              setSection(section.mode === 'updates' ? { mode: 'positions' } : { mode: 'updates' })
              window.scrollTo({ top: 0 })
            }}
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">今日更新</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`hidden min-h-11 gap-1.5 px-2 sm:min-h-8 md:inline-flex ${section.mode === 'calendar' ? 'text-primary' : ''}`}
            aria-label="截止日历"
            title="截止日历"
            onClick={() => {
              setSection(section.mode === 'calendar' ? { mode: 'positions' } : { mode: 'calendar' })
              window.scrollTo({ top: 0 })
            }}
          >
            <CalendarDays className="h-4 w-4" />
            <span className="hidden sm:inline">日历</span>
          </Button>
          <Button variant="ghost" size="sm" className="hidden min-h-11 gap-1.5 sm:min-h-8 md:inline-flex" onClick={() => setGuideOpen(true)}>
            <BookOpen className="h-4 w-4" />
            求职攻略
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1.5 px-2 sm:min-h-8"
            aria-label="最近浏览"
            title="最近浏览"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="h-4 w-4" />
            <span className="hidden lg:inline">最近浏览</span>
          </Button>
          <Button variant="outline" size="sm" className="relative hidden min-h-11 gap-1.5 sm:min-h-8 md:inline-flex" onClick={() => setFavOpen(true)}>
            <Star className="h-4 w-4 text-amber-400" />
            我的收藏
            {dueSoon > 0 && (
              <span
                className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
                title={`${dueSoon} 个收藏岗位 ${remindDays} 天内截止`}
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

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {tab !== 'admin' && section.mode !== 'calendar' && (
          <OnboardingCard
            onOpenTips={() => {
              window.history.replaceState(
                null,
                '',
                window.location.pathname + window.location.search + '#tips',
              )
              setGuideOpen(true)
            }}
          />
        )}
        <div key={tab === 'admin' ? 'admin' : section.mode} className="animate-fade-in-up">
          {tab !== 'admin' && section.mode === 'positions' && (
            <SearchPage
              key={`${section.preset ?? ''}|${section.keyword ?? ''}|${(posEduLevel ?? []).join(',')}|${posQuick?.province ?? ''}|${posQuick?.city ?? ''}`}
              initialPresetKey={section.preset}
              initialKeyword={section.keyword}
              initialEduLevel={posEduLevel}
              initialProvince={posQuick?.province ? [posQuick.province] : undefined}
              initialLocation={posQuick?.city ? [posQuick.city] : undefined}
              crossPresets={CAMPUS_CROSS}
              onCrossPreset={(k) => (k.startsWith('bz:') ? goBianzhi(k.slice(3)) : goCampus(k))}
              crossLabel="校招信息"
              crossFetchTotal={campusTotal}
              onCrossOpen={(kw) => goCampus('all', kw)}
              onOpenBoardKw={openBoardKw}
              onOpenUpdates={() => {
                setSection({ mode: 'updates' })
                window.scrollTo({ top: 0 })
              }}
            />
          )}
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            {tab !== 'admin' && section.mode === 'campus' && (
              <CampusPage
                key={`${section.preset ?? ''}|${section.keyword ?? ''}|${boardQuickNonce}`}
                initialPreset={section.preset}
                initialKeyword={section.keyword}
                crossPresets={POSITION_CROSS}
                onCrossPreset={(k) => (k.startsWith('bz:') ? goBianzhi(k.slice(3)) : goPositions(k))}
                crossLabel="体制内岗位"
                crossFetchTotal={positionsTotal}
                onCrossOpen={(kw) => goPositions('all', kw)}
                onOpenBoardKw={openBoardKw}
              />
            )}
            {tab !== 'admin' && section.mode === 'bianzhi' && (
              <BianzhiPage
                key={`${section.preset ?? ''}|${section.keyword ?? ''}|${boardQuickNonce}`}
                initialPreset={section.preset}
                initialKeyword={section.keyword}
                crossPresets={BIANZHI_CROSS}
                onCrossPreset={(k) =>
                  k.startsWith('pos:') ? goPositions(k.slice(4)) : goCampus(k.slice(7))
                }
                crossLabel="校招信息"
                crossFetchTotal={campusTotal}
                onCrossOpen={(kw) => goCampus('all', kw)}
                onOpenBoardKw={openBoardKw}
              />
            )}
            {tab !== 'admin' && section.mode === 'calendar' && <CalendarPage />}
            {tab !== 'admin' && section.mode === 'updates' && (
              <RecentUpdatesPage
                onOpenJob={(board, id) => openSearchJob(board, id, '')}
                onOpenBoard={(board) => {
                  if (board === 'positions') goPositions('all')
                  else if (board === 'campus') goCampus('all')
                  else goBianzhi('all')
                }}
              />
            )}
            {tab === 'admin' && showAdmin && <AdminPage />}
          </Suspense>
        </div>
      </main>

      <footer className="border-t bg-background py-6 pb-24 text-center text-xs text-muted-foreground md:pb-16">
        <div className="mb-2 flex items-center justify-center gap-4">
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:min-h-0"
            onClick={() => {
              setSection({ mode: 'updates' })
              window.scrollTo({ top: 0 })
            }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            今日更新
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:min-h-0"
            onClick={() => {
              setSection({ mode: 'calendar' })
              window.scrollTo({ top: 0 })
            }}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            日历
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:min-h-0"
            onClick={() => setGuideOpen(true)}
          >
            <BookOpen className="h-3.5 w-3.5" />
            求职攻略
          </button>
        </div>
        数据来源：国家公务员局、军队人才网、国聘网及各省官方/汇总页面 · 仅供参考 ·{' '}
        <button
          type="button"
          className="underline underline-offset-4 hover:text-foreground"
          onClick={() => {
            window.history.replaceState(
              null,
              '',
              window.location.pathname + window.location.search + '#about',
            )
            setGuideOpen(true)
          }}
        >
          数据说明
        </button>
      </footer>

      <MobileBottomNav
        active={tab === 'admin' ? null : section.mode === 'calendar' ? 'calendar' : 'jobs'}
        favCount={favorites.length + campusFavorites.length + bianzhiFavorites.length}
        dueSoon={dueSoon}
        onJobs={() => {
          if (section.mode === 'calendar') setSection({ mode: 'positions' })
          window.scrollTo({ top: 0 })
        }}
        onCalendar={() => {
          if (section.mode !== 'calendar') setSection({ mode: 'calendar' })
          window.scrollTo({ top: 0 })
        }}
        onFavorites={() => setFavOpen(true)}
        onGuide={() => setGuideOpen(true)}
      />
      <Suspense fallback={null}>
        {searchOpen && (
          <GlobalSearch
            onQuickFilter={quickFilter}
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            onOpenBoard={openSearchBoard}
            onOpenJob={openSearchJob}
          />
        )}
        {favOpen && (
          <FavoritesSheet
            open={favOpen}
            onClose={() => setFavOpen(false)}
            onOpenHistory={() => {
              setFavOpen(false)
              setHistoryOpen(true)
            }}
          />
        )}
        {historyOpen && (
          <ViewHistorySheet
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            onOpenJob={(board, id) => openSearchJob(board, id, '')}
          />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {guideOpen && <JobGuideSheet open={guideOpen} onClose={() => setGuideOpen(false)} />}
      </Suspense>
      <CompareBar />
      <BoardCompareBar onOpenJob={(board, id) => openSearchJob(board, id, '')} />
      {deepLinked && (
        <LazyPositionSheet
          item={deepLinked}
          onClose={() => setDeepLinked(null)}
          onOpenItem={setDeepLinked}
          onTagClick={(k) => {
            if (k !== 'edu_bk') return
            setDeepLinked(null)
            goPositions('all', undefined, ['本科'])
          }}
        />
      )}
    </div>
  )
}
