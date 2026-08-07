import { getLang, setLang, t, tt } from '@/lib/i18n'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchCampusJobs, fetchPosition, fetchPositions, type Position } from '@/api'
import { importFavorites } from '@/lib/positionStore'
import { LazyPositionSheet } from '@/components/LazyPositionSheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SearchPage } from '@/components/SearchPage'
import { Skeleton } from '@/components/ui/skeleton'
import { BookOpen, Briefcase, CalendarDays, History, Languages, Layers, Moon, Search, Settings, Sparkles, Star, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { BoardCompareBar } from '@/components/BoardCompareBar'
import { MobileBottomNav } from '@/components/MobileBottomNav'
import { RemindToastHost } from '@/components/RemindToastHost'
import { ApplyPromptHost } from '@/components/ApplyPromptHost'
import { OnboardingCard } from '@/components/OnboardingCard'
import { useFavorites } from '@/lib/positionStore'
import { useBianzhiFavorites, useCampusFavorites } from '@/lib/boardFavorites'
import type { QuickFilter, SearchBoard } from '@/components/GlobalSearch'
import { applySeo } from '@/lib/seo'
import { readJobParam, setJobParam } from '@/lib/jobDeepLink'
import { POSITION_URL_KEYS } from '@/lib/urlFilters'
import { daysUntil, getEffectiveDeadline, parseSignupDeadline } from '@/lib/deadline'
import { useRemindDays, useRemindNodes } from '@/lib/reminderPref'
import { useReminders } from '@/lib/reminders'
import { maybeNotifyDue } from '@/lib/dueNotification'
import { buildPushItems, syncPushItems } from '@/lib/push'
import {
  maybeNotifySavedNews,
  openSubscriptionsPanel,
  refreshSavedNews,
  useSavedNews,
} from '@/lib/savedNews'
import { SubscriptionsSheet } from '@/components/SubscriptionsSheet'
import { lazyRetry } from '@/lib/lazyRetry'
import { BoardErrorBoundary } from '@/components/BoardErrorBoundary'
import { NotFoundPage } from '@/components/NotFoundPage'
import { reportPv } from '@/lib/metrics'

const JobGuideSheet = lazy(() =>
  lazyRetry(() => import('@/components/JobGuideSheet').then((m) => ({ default: m.JobGuideSheet }))),
)

const GUIDE_SECTION_KEYS = ['mindset', 'resume', 'interview', 'timeline', 'biancal', 'company', 'choose', 'tips', 'examcal', 'about', 'faq']

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
const SearchResultsPage = lazy(() =>
  lazyRetry(() => import('@/components/SearchResultsPage').then((m) => ({ default: m.SearchResultsPage }))),
)
const UnifiedJobsPage = lazy(() =>
  lazyRetry(() => import('@/components/UnifiedJobsPage').then((m) => ({ default: m.UnifiedJobsPage }))),
)

const showAdmin = new URLSearchParams(window.location.search).get('admin') === '1'

// SPA 只服务根路径（深链全部走 query 参数）；未知路径由后端回落 index.html（404 状态），
// 客户端渲染品牌化 404 视图而非完整首页，与 SSR 404 页口径一致。
const isNotFound = window.location.pathname !== '/'

const CAMPUS_CROSS = [
  { key: 'all', label: t("校招") },
  { key: 'noexam', label: t("免笔试") },
  { key: 'referral', label: t("内推码") },
  { key: 'intern', label: t("实习") },
  { key: 'autumn', label: t("秋招") },
  { key: 'bz:all', label: t("编制公告") },
  { key: 'bz:edu', label: t("教师招聘") },
  { key: 'bz:med', label: t("医疗招聘") },
]

const POSITION_CROSS = [
  { key: 'all', label: t("体制内全部") },
  { key: 'gwy', label: t("公务员") },
  { key: 'sye', label: t("事业编") },
  { key: 'jdwz', label: t("军队文职") },
  { key: 'gqyq', label: t("国企央企") },
  { key: 'xds', label: t("选调生") },
  { key: 'bz:all', label: t("编制公告") },
  { key: 'bz:edu', label: t("教师招聘") },
  { key: 'bz:med', label: t("医疗招聘") },
]

const BIANZHI_CROSS = [
  { key: 'pos:all', label: t("体制内岗位") },
  { key: 'pos:gwy', label: t("公务员") },
  { key: 'campus:all', label: t("校招信息") },
  { key: 'campus:noexam', label: t("免笔试") },
]

//: 「全部岗位」页的 URL 深链参数（UnifiedJobsPage 内维护）
const ALLJOBS_URL_KEYS = ['ajkw', 'ajb', 'ajp', 'ajc', 'aje', 'ajdue', 'ajhexp', 'ajsort', 'ajview']

interface Section {
  mode: 'positions' | 'campus' | 'bianzhi' | 'calendar' | 'updates' | 'search' | 'all'
  preset?: string
  keyword?: string
}

function initialSection(): Section {
  const q = new URLSearchParams(window.location.search)
  let board = q.get('board')
  // 深链 ?job=board:id 不带 board 参数时，按 job 前缀自动切到对应板块
  if (!board) {
    const jobBoard = (q.get('job') || '').split(':')[0]
    if (jobBoard === 'campus' || jobBoard === 'bianzhi') board = jobBoard
  }
  if (board === 'campus' || board === 'bianzhi') {
    return { mode: board, preset: q.get('bpreset') || undefined }
  }
  if (board === 'all') return { mode: 'all' }
  if (board === 'calendar') return { mode: 'calendar' }
  if (board === 'updates') return { mode: 'updates' }
  if (board === 'search') {
    const kw = (q.get('q') || '').trim()
    if (kw) return { mode: 'search', keyword: kw }
  }
  return { mode: 'positions' }
}

function syncSectionUrl(section: Section) {
  const q = new URLSearchParams(window.location.search)
  if (section.mode !== 'search') q.delete('q')
  if (section.mode === 'search') {
    q.set('board', 'search')
    q.set('q', section.keyword || '')
    for (const k of ['bpreset', 'due', 'city', 'ctype', 'prov', 'bcity', 'bkw', 'bedu', 'cedu', 'cfrom', 'cto', 'bfrom', 'bto', 'hexp', 'hseen', 'cview', 'ub', 'cboard']) q.delete(k)
    for (const k of POSITION_URL_KEYS) q.delete(k)
    for (const k of ALLJOBS_URL_KEYS) q.delete(k)
  } else if (section.mode === 'all') {
    q.set('board', 'all')
    for (const k of ['bpreset', 'due', 'city', 'ctype', 'prov', 'bcity', 'bkw', 'bedu', 'cedu', 'cfrom', 'cto', 'bfrom', 'bto', 'hexp', 'hseen', 'cview', 'ub', 'cboard']) q.delete(k)
    for (const k of POSITION_URL_KEYS) q.delete(k)
  } else if (section.mode === 'positions') {
    if (q.get('board')) {
      q.delete('hexp')
      q.delete('hseen')
    }
    q.delete('board')
    q.delete('bpreset')
    q.delete('due')
    q.delete('city')
    q.delete('ctype')
    q.delete('prov')
    q.delete('bcity')
    q.delete('bkw')
    q.delete('bedu')
    q.delete('cedu')
    q.delete('cfrom')
    q.delete('cto')
    q.delete('bfrom')
    q.delete('bto')
    q.delete('cview')
    q.delete('ub')
    for (const k of ALLJOBS_URL_KEYS) q.delete(k)
  } else if (section.mode === 'calendar' || section.mode === 'updates') {
    q.set('board', section.mode)
    for (const k of ['bpreset', 'due', 'city', 'ctype', 'prov', 'bcity', 'bkw', 'bedu', 'cedu', 'cfrom', 'cto', 'bfrom', 'bto', 'hexp', 'hseen']) q.delete(k)
    if (section.mode === 'updates') {
      q.delete('cview')
      q.delete('cboard')
    } else {
      q.delete('ub')
    }
    for (const k of POSITION_URL_KEYS) q.delete(k)
    for (const k of ALLJOBS_URL_KEYS) q.delete(k)
  } else {
    if (q.get('board') !== section.mode) {
      q.delete('hexp')
      q.delete('hseen')
    }
    q.set('board', section.mode)
    q.delete('cview')
    q.delete('ub')
    for (const k of ALLJOBS_URL_KEYS) q.delete(k)
    for (const k of POSITION_URL_KEYS) {
      if (k !== 'hexp') q.delete(k)
    }
    if (section.preset) q.set('bpreset', section.preset)
    else q.delete('bpreset')
    if (section.mode === 'campus') {
      q.delete('prov')
      q.delete('bcity')
      q.delete('bedu')
      q.delete('bfrom')
      q.delete('bto')
    } else {
      q.delete('city')
      q.delete('ctype')
      q.delete('cedu')
      q.delete('cfrom')
      q.delete('cto')
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
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label={t("上岸雷达")}>
      <defs>
        <linearGradient id="brand-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2563EB" />
          <stop offset="1" stopColor="#0891B2" />
        </linearGradient>
        <linearGradient id="brand-sweep" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#brand-bg)" />
      <circle cx="32" cy="34" r="21" fill="none" stroke="#FFFFFF" strokeWidth="2.5" opacity="0.9" />
      <circle cx="32" cy="34" r="13.5" fill="none" stroke="#FFFFFF" strokeWidth="1.8" opacity="0.55" />
      <circle cx="32" cy="34" r="6.5" fill="none" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.35" />
      <path d="M32 34 L32 13 A21 21 0 0 1 46.9 19.2 Z" fill="url(#brand-sweep)" />
      <line x1="32" y1="34" x2="46.9" y2="19.2" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="34" r="3" fill="#FFFFFF" />
      <circle cx="41" cy="26.5" r="2.6" fill="#FFFFFF" />
      <circle cx="23" cy="42" r="2" fill="#FFFFFF" opacity="0.85" />
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
  const remindNodes = useRemindNodes()
  const reminders = useReminders()
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
    if (isNotFound) {
      document.title = t('页面不存在 - 上岸雷达')
      return
    }
    syncSectionUrl(section)
    applySeo(section.mode, section.preset, section.keyword)
  }, [section])

  useEffect(() => {
    reportPv(tab === 'admin' ? 'admin' : section.mode)
  }, [tab, section.mode])

  useEffect(() => {
    const h = window.location.hash.slice(1)
    if (GUIDE_SECTION_KEYS.includes(h)) setGuideOpen(true)
  }, [])

  useEffect(() => {
    maybeNotifyDue(dueSoon, remindDays, () => setFavOpen(true))
  }, [dueSoon, remindDays])

  // 已开启关站推送时，收藏/提醒节点变化后同步最新截止快照到服务端。
  // 首次立即执行（syncPushItems 内部等 SW ready），订阅丢失自愈单次刷新即恢复；后续变化防抖 3s
  const pushSyncedOnce = useRef(false)
  useEffect(() => {
    const run = () =>
      void syncPushItems(buildPushItems(favorites, campusFavorites, bianzhiFavorites))
    if (!pushSyncedOnce.current) {
      pushSyncedOnce.current = true
      run()
      return
    }
    const t = window.setTimeout(run, 3000)
    return () => window.clearTimeout(t)
  }, [favorites, campusFavorites, bianzhiFavorites, remindNodes, reminders])

  // 推送通知点击落地 /?fav=1 → 收藏面板；/?subs=1 → 订阅面板
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const fav = q.get('fav') === '1'
    const subs = q.get('subs') === '1'
    if (fav) setFavOpen(true)
    if (subs) openSubscriptionsPanel()
    if (fav || subs) {
      q.delete('fav')
      q.delete('subs')
      const rest = q.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`)
    }
  }, [])

  const savedNews = useSavedNews()
  useEffect(() => {
    refreshSavedNews(() => maybeNotifySavedNews(openSubscriptionsPanel))
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
    for (const k of ['city', 'ctype', 'prov', 'bcity', 'bkw', 'bedu', 'cedu', 'cfrom', 'cto', 'bfrom', 'bto']) q.delete(k)
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
  /** 带省份直达编制板（prov 入 URL，供 0 结果跨板块导流） */
  const goBianzhiProv = useCallback(
    (province: string, preset?: string) => {
      clearBoardParams()
      const q = new URLSearchParams(window.location.search)
      q.set('prov', province)
      window.history.replaceState(null, '', `?${q.toString()}${window.location.hash}`)
      setBoardQuickNonce((n) => n + 1)
      setSection({ mode: 'bianzhi', preset: preset && preset !== 'all' ? preset : undefined })
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

  const openSearchAll = useCallback((kw: string) => {
    setSection({ mode: 'search', keyword: kw })
    window.scrollTo({ top: 0 })
  }, [])

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
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 max-sm:py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark className="h-9 w-9 shrink-0" />
            <div className="flex min-w-0 flex-col leading-none">
              <h1 className="truncate whitespace-nowrap text-lg font-bold tracking-tight">{t("上岸雷达")}</h1>
              <span className="mt-0.5 hidden truncate whitespace-nowrap text-[11px] tracking-widest text-muted-foreground lg:block">
                {t("体制内岗位 · 校招信息 一站检索")}{' '}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="relative min-h-10 gap-1.5 px-2 sm:min-h-8"
            aria-label={t("全站搜索")}
            title={t("全站搜索（Ctrl K）")}
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-4 w-4" />
            {savedNews.sum > 0 && (
              <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-red-500" aria-label={t("常用筛选有上新")} />
            )}
            <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/80 lg:inline">
              Ctrl K
            </kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-10 min-w-10 gap-1.5 px-2 sm:min-h-8 sm:min-w-0"
            onClick={cycleTheme}
            title={theme === 'system' ? t("主题：跟随系统") : theme === 'dark' ? t("主题：暗色") : t("主题：亮色")}
            aria-label={t("切换主题")}
          >
            {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {theme === 'system' && <span className="hidden text-[11px] text-muted-foreground lg:inline">{t("自动")}</span>}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-10 gap-1 px-2 sm:min-h-8"
            onClick={() => setLang(getLang() === 'en' ? 'zh' : 'en')}
            title={getLang() === 'en' ? '切换到中文' : 'Switch to English'}
            aria-label={getLang() === 'en' ? '切换到中文' : 'Switch to English'}
          >
            <Languages className="h-4 w-4" />
            <span className="hidden text-[11px] font-medium sm:inline">{getLang() === 'en' ? '中文' : 'EN'}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`min-h-10 gap-1.5 px-2 sm:min-h-8 ${section.mode === 'all' ? 'text-primary' : ''}`}
            aria-label={t("全部岗位")}
            title={t("体制内/校招/编制合并检索")}
            onClick={() => {
              setSection(section.mode === 'all' ? { mode: 'positions' } : { mode: 'all' })
              window.scrollTo({ top: 0 })
            }}
          >
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline">{t("全部岗位")}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`hidden min-h-10 gap-1.5 px-2 sm:min-h-8 md:inline-flex ${section.mode === 'updates' ? 'text-primary' : ''}`}
            aria-label={t("今日更新")}
            title={t("近 7 天新增岗位")}
            onClick={() => {
              setSection(section.mode === 'updates' ? { mode: 'positions' } : { mode: 'updates' })
              window.scrollTo({ top: 0 })
            }}
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">{t("今日更新")}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`hidden min-h-10 gap-1.5 px-2 sm:min-h-8 md:inline-flex ${section.mode === 'calendar' ? 'text-primary' : ''}`}
            aria-label={t("截止日历")}
            title={t("截止日历")}
            onClick={() => {
              setSection(section.mode === 'calendar' ? { mode: 'positions' } : { mode: 'calendar' })
              window.scrollTo({ top: 0 })
            }}
          >
            <CalendarDays className="h-4 w-4" />
            <span className="hidden sm:inline">{t("日历")}</span>
          </Button>
          <Button variant="ghost" size="sm" className="hidden min-h-10 gap-1.5 sm:min-h-8 md:inline-flex" onClick={() => setGuideOpen(true)}>
            <BookOpen className="h-4 w-4" />
            {t("求职攻略")}{' '}</Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-10 gap-1.5 px-2 sm:min-h-8"
            aria-label={t("最近浏览")}
            title={t("最近浏览")}
            onClick={() => setHistoryOpen(true)}
          >
            <History className="h-4 w-4" />
            <span className="hidden lg:inline">{t("最近浏览")}</span>
          </Button>
          <Button variant="outline" size="sm" className="relative hidden min-h-10 gap-1.5 sm:min-h-8 md:inline-flex" onClick={() => setFavOpen(true)}>
            <Star className="h-4 w-4 text-amber-400" />
            {t("我的收藏")}{' '}{dueSoon > 0 && (
              <span
                className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
                title={tt`${dueSoon} 个收藏岗位 ${remindDays} 天内截止`}
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
                  {t("岗位检索")}{' '}</TabsTrigger>
                <TabsTrigger value="admin" className="gap-1.5">
                  <Settings className="h-4 w-4" />
                  {t("管理")}{' '}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 max-sm:pt-2">
        {isNotFound ? (
          <NotFoundPage />
        ) : (
          <>
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
              onCrossPreset={(k) => {
                if (k.startsWith('bzp:')) {
                  const [, preset, prov] = k.split(':')
                  goBianzhiProv(prov, preset)
                } else if (k.startsWith('bz:')) goBianzhi(k.slice(3))
                else goCampus(k)
              }}
              crossLabel={t("校招信息")}
              crossFetchTotal={campusTotal}
              onCrossOpen={(kw) => goCampus('all', kw)}
              onOpenBoardKw={openBoardKw}
              onOpenUpdates={() => {
                setSection({ mode: 'updates' })
                window.scrollTo({ top: 0 })
              }}
            />
          )}
          <BoardErrorBoundary
            resetKey={`${tab}|${section.mode}|${section.preset ?? ''}|${section.keyword ?? ''}|${boardQuickNonce}`}
          >
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            {tab !== 'admin' && section.mode === 'campus' && (
              <CampusPage
                key={`${section.preset ?? ''}|${section.keyword ?? ''}|${boardQuickNonce}`}
                initialPreset={section.preset}
                initialKeyword={section.keyword}
                crossPresets={POSITION_CROSS}
                onCrossPreset={(k) => (k.startsWith('bz:') ? goBianzhi(k.slice(3)) : goPositions(k))}
                crossLabel={t("体制内岗位")}
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
                crossLabel={t("校招信息")}
                crossFetchTotal={campusTotal}
                onCrossOpen={(kw) => goCampus('all', kw)}
                onOpenBoardKw={openBoardKw}
              />
            )}
            {tab !== 'admin' && section.mode === 'search' && (
              <SearchResultsPage
                key={section.keyword ?? ''}
                keyword={section.keyword ?? ''}
                onSearch={openSearchAll}
                onOpenBoard={openSearchBoard}
                onOpenJob={openSearchJob}
              />
            )}
            {tab !== 'admin' && section.mode === 'all' && <UnifiedJobsPage />}
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
          </BoardErrorBoundary>
        </div>
          </>
        )}
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
            {t("今日更新")}{' '}</button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:min-h-0"
            onClick={() => {
              setSection({ mode: 'calendar' })
              window.scrollTo({ top: 0 })
            }}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {t("日历")}{' '}</button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:min-h-0"
            onClick={() => setGuideOpen(true)}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t("求职攻略")}{' '}</button>
        </div>
        <div className="mb-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <a href="/topic" className="underline-offset-4 hover:text-foreground hover:underline">
            {t("岗位专题")}
          </a>
          <a href="/rank" className="underline-offset-4 hover:text-foreground hover:underline">
            {t("数据榜单")}
          </a>
          <a href="/zhaokao" className="underline-offset-4 hover:text-foreground hover:underline">
            {t("按省份浏览")}
          </a>
          <a href="/major" className="underline-offset-4 hover:text-foreground hover:underline">
            {t("按专业反查")}
          </a>
          <a href="/daily" className="underline-offset-4 hover:text-foreground hover:underline">
            {t("每日精选")}
          </a>
        </div>
        {t("数据来源：国家公务员局、军队人才网、国聘网及各省官方/汇总页面 · 仅供参考 ·")}{' '}
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
          {t("数据说明")}{' '}</button>
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
            onOpenAll={openSearchAll}
          />
        )}
        {favOpen && (
          <FavoritesSheet
            open={favOpen}
            initialBoard={
              section.mode === 'campus' || section.mode === 'bianzhi' ? section.mode : 'positions'
            }
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
      <BoardCompareBar onOpenJob={(board, id) => openSearchJob(board, id, '')} />
      <SubscriptionsSheet />
      <RemindToastHost />
      <ApplyPromptHost />
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
