import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Briefcase, Clock, Filter, GraduationCap, Landmark, LayoutList, X } from 'lucide-react'
import {
  fetchBianzhiJobs,
  fetchCampusJobs,
  fetchFilters,
  fetchPositions,
  formatTotal,
  type BianzhiJob,
  type CampusJob,
  type FilterOptions,
  type Position,
} from '@/api'
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { stripOrgPrefix } from '@/lib/orgPrefix'
import { pinyinMatch } from '@/lib/pinyin'
import { expandKeyword, getSynonyms, HOT_SEARCHES } from '@/lib/synonyms'
import { PINYIN_WORDS } from '@/lib/pinyinDict'
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  removeRecentSearch,
} from '@/lib/storage'

export type SearchBoard = 'positions' | 'campus' | 'bianzhi'

interface BoardHits {
  positions: { total: number; capped: boolean; items: Position[] }
  campus: { total: number; capped: boolean; items: CampusJob[] }
  bianzhi: { total: number; capped: boolean; items: BianzhiJob[] }
}

/** 快捷筛选跳转：省份或城市 + 剩余关键词 */
export interface QuickFilter {
  province?: string
  city?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onOpenBoard: (board: SearchBoard, keyword: string) => void
  onOpenJob: (board: SearchBoard, id: number, keyword: string) => void
  onQuickFilter?: (board: SearchBoard, filter: QuickFilter, keyword: string) => void
  /** 打开聚合搜索结果视图（?board=search&q=）。 */
  onOpenAll?: (keyword: string) => void
}

const SHOW = 5

let placesPromise: Promise<FilterOptions> | null = null
function loadPlaces(): Promise<FilterOptions> {
  if (!placesPromise) {
    placesPromise = fetchFilters().catch((e) => {
      placesPromise = null
      throw e
    })
  }
  return placesPromise
}

interface PlaceMatch {
  name: string
  type: 'province' | 'city'
  rest: string
}

/** 从输入中识别省份/城市名（复用筛选项词表），剩余部分作为关键词。 */
function matchPlace(kw: string, provinces: string[], cities: Set<string>): PlaceMatch | null {
  const tokens = kw.split(/\s+/).filter(Boolean)
  for (const t of tokens) {
    const type = provinces.includes(t) ? 'province' : cities.has(t) ? 'city' : null
    if (type) {
      return { name: t, type, rest: tokens.filter((x) => x !== t).join(' ') }
    }
  }
  // 无空格输入：前缀匹配（如「江西教师」）
  if (tokens.length === 1 && tokens[0].length > 2) {
    const s = tokens[0]
    for (const p of provinces) {
      if (s.startsWith(p) && s.length > p.length) return { name: p, type: 'province', rest: s.slice(p.length) }
    }
    for (const c of cities) {
      if (s.startsWith(c) && s.length > c.length) return { name: c, type: 'city', rest: s.slice(c.length) }
    }
  }
  return null
}

interface QuickSuggestion {
  key: string
  board: SearchBoard
  label: string
  filter: QuickFilter
  rest: string
}

export function GlobalSearch({ open, onClose, onOpenBoard, onOpenJob, onQuickFilter, onOpenAll }: Props) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<BoardHits | null>(null)
  const [loading, setLoading] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [places, setPlaces] = useState<{ provinces: string[]; cities: Set<string> } | null>(null)
  const [synOff, setSynOff] = useState(false)
  const [pyTick, setPyTick] = useState(0)

  useEffect(() => {
    if (!open) {
      setQ('')
      setHits(null)
    } else {
      setRecent(getRecentSearches())
      if (!places) {
        loadPlaces()
          .then((f) => {
            const provinces = (f.location_tree ?? []).map((n) => n.province)
            const cities = new Set((f.location_tree ?? []).flatMap((n) => n.cities))
            setPlaces({ provinces, cities })
          })
          .catch(() => undefined)
      }
    }
  }, [open, places])

  useEffect(() => {
    setSynOff(false)
  }, [q])

  useEffect(() => {
    const kw = q.trim()
    if (!kw) {
      setHits(null)
      setLoading(false)
      return
    }
    const sendKw = synOff ? kw : expandKeyword(kw).expanded
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      Promise.allSettled([
        fetchPositions({ keyword: sendKw, page: 1, page_size: SHOW }),
        fetchCampusJobs({ keyword: sendKw, page: 1, page_size: SHOW }),
        fetchBianzhiJobs({ keyword: sendKw, page: 1, page_size: SHOW }),
      ]).then(([p, c, b]) => {
        if (cancelled) return
        setHits({
          positions:
            p.status === 'fulfilled'
              ? { total: p.value.total, capped: !!p.value.total_capped, items: p.value.items }
              : { total: 0, capped: false, items: [] },
          campus:
            c.status === 'fulfilled'
              ? { total: c.value.total, capped: !!c.value.total_capped, items: c.value.items }
              : { total: 0, capped: false, items: [] },
          bianzhi:
            b.status === 'fulfilled'
              ? { total: b.value.total, capped: !!b.value.total_capped, items: b.value.items }
              : { total: 0, capped: false, items: [] },
        })
        setLoading(false)
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, synOff])

  const kw = q.trim()
  const synAdded = kw && !synOff ? expandKeyword(kw).added : []

  const pinyinSuggestions = useMemo(() => {
    void pyTick
    if (!/^[a-zA-Z]{2,}$/.test(kw) || !places) return []
    const pool = [...new Set([...PINYIN_WORDS, ...places.provinces, ...places.cities])]
    return pool.filter((t) => pinyinMatch(t, kw)).slice(0, 8)
  }, [kw, places, pyTick])

  // pinyin-pro 懒加载：首次拉丁查询时词库可能未就绪，短延迟后重算一次
  useEffect(() => {
    if (!/^[a-zA-Z]{2,}$/.test(kw) || pinyinSuggestions.length > 0) return
    const t = setTimeout(() => setPyTick((n) => n + 1), 600)
    return () => clearTimeout(t)
  }, [kw, pinyinSuggestions.length])

  const quickSuggestions = useMemo<QuickSuggestion[]>(() => {
    if (!kw || !places || !onQuickFilter) return []
    const m = matchPlace(kw, places.provinces, places.cities)
    if (!m) return []
    const restLabel = m.rest ? `并搜「${m.rest}」` : ''
    const out: QuickSuggestion[] = []
    if (m.type === 'province') {
      out.push(
        { key: 'qf-pos', board: 'positions', label: `在体制内按省份『${m.name}』筛选${restLabel}`, filter: { province: m.name }, rest: m.rest },
        { key: 'qf-bz', board: 'bianzhi', label: `在编制按省份『${m.name}』筛选${restLabel}`, filter: { province: m.name }, rest: m.rest },
        { key: 'qf-camp', board: 'campus', label: `在校招按地点『${m.name}』筛选${restLabel}`, filter: { city: m.name }, rest: m.rest },
      )
    } else {
      out.push(
        { key: 'qf-pos', board: 'positions', label: `在体制内按城市『${m.name}』筛选${restLabel}`, filter: { city: m.name }, rest: m.rest },
        { key: 'qf-camp', board: 'campus', label: `在校招按地点『${m.name}』筛选${restLabel}`, filter: { city: m.name }, rest: m.rest },
      )
    }
    return out.slice(0, 3)
  }, [kw, places, onQuickFilter])

  const pickQuick = (s: QuickSuggestion) => {
    if (kw) setRecent(addRecentSearch(kw))
    onClose()
    onQuickFilter?.(s.board, s.filter, s.rest)
  }

  const empty =
    !!kw &&
    !loading &&
    !!hits &&
    hits.positions.total === 0 &&
    hits.campus.total === 0 &&
    hits.bianzhi.total === 0

  const pick = (board: SearchBoard, id: number) => {
    if (kw) setRecent(addRecentSearch(kw))
    onClose()
    onOpenJob(board, id, kw)
  }
  const pickAll = (board: SearchBoard) => {
    if (kw) setRecent(addRecentSearch(kw))
    onClose()
    onOpenBoard(board, kw)
  }
  const pickAggregate = () => {
    if (kw) setRecent(addRecentSearch(kw))
    onClose()
    onOpenAll?.(kw)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="全站搜索"
      description="同时搜索体制内、校招、编制三个板块"
      showCloseButton
      className="max-sm:inset-0 max-sm:top-0 max-sm:h-dvh max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none!"
    >
      <Command shouldFilter={false} loop className="max-sm:h-full">
        <CommandInput
          placeholder="搜索岗位 / 单位 / 公司…（同时搜三板块）"
          value={q}
          onValueChange={setQ}
        />
        {kw && synAdded.length > 0 && (
          <div className="flex items-center gap-1 border-b bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">已同时匹配：{synAdded.join('、')}</span>
            <button
              type="button"
              aria-label="关闭同义扩展"
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground sm:h-7 sm:w-7"
              onClick={() => setSynOff(true)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {!kw && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            输入关键词，同时搜索 体制内 / 校招 / 编制 三个板块
            <span className="mt-1 block text-xs">Ctrl K 随时打开 · 上下键选择 · 回车直达详情</span>
          </div>
        )}
        {!kw && recent.length > 0 && (
          <div className="border-t px-3 pb-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Clock className="h-3 w-3" /> 最近搜索
              </span>
              <button
                type="button"
                className="min-h-9 cursor-pointer px-1 text-xs text-muted-foreground hover:text-foreground sm:min-h-0"
                onClick={() => setRecent(clearRecentSearches())}
              >
                清空
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {recent.slice(0, 8).map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-0.5 rounded-full bg-muted pl-2.5 pr-1 text-xs text-foreground/80"
                >
                  <button
                    type="button"
                    className="min-h-9 cursor-pointer py-1 hover:text-foreground sm:min-h-7"
                    onClick={() => setQ(k)}
                  >
                    {k}
                  </button>
                  <button
                    type="button"
                    aria-label={`删除最近搜索 ${k}`}
                    className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => setRecent(removeRecentSearch(k))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        {kw && loading && !hits && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">搜索中…</div>
        )}
        <CommandList className="sm:max-h-96 max-sm:max-h-[calc(100dvh-64px)]">
          {kw && pinyinSuggestions.length > 0 && (
            <CommandGroup heading="拼音联想">
              {pinyinSuggestions.map((s) => (
                <CommandItem
                  key={`py-${s}`}
                  value={`py-${s}`}
                  className="min-h-11"
                  onSelect={() => setQ(s)}
                >
                  <ArrowRight className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {s}
                    <span className="ml-1.5 text-xs text-muted-foreground">拼音匹配「{kw}」</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {kw && quickSuggestions.length > 0 && (
            <>
            {pinyinSuggestions.length > 0 && <CommandSeparator />}
            <CommandGroup heading="快捷筛选">
              {quickSuggestions.map((s) => (
                <CommandItem
                  key={s.key}
                  value={s.key}
                  className="min-h-11"
                  onSelect={() => pickQuick(s)}
                >
                  <Filter className="text-primary" />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <ArrowRight className="text-muted-foreground" />
                </CommandItem>
              ))}
            </CommandGroup>
            </>
          )}
          {kw && hits && hits.positions.total > 0 && (
            <>
            {(quickSuggestions.length > 0 || pinyinSuggestions.length > 0) && <CommandSeparator />}
            <CommandGroup heading={`体制内岗位 · ${formatTotal(hits.positions.total, hits.positions.capped)} 条`}>
              {hits.positions.items.map((p) => (
                <CommandItem
                  key={`positions-${p.id}`}
                  value={`positions-${p.id}`}
                  onSelect={() => pick('positions', p.id)}
                >
                  <Landmark className="text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {p.position_example
                        ? stripOrgPrefix(p.position_example, p.employer)
                        : p.exam_type || '-'}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground group-data-selected/command-item:text-foreground/75">
                      {[p.employer, p.work_location].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </CommandItem>
              ))}
              {hits.positions.total > hits.positions.items.length && (
                <CommandItem value="positions-all" className="max-sm:min-h-11" onSelect={() => pickAll('positions')}>
                  <ArrowRight className="text-muted-foreground" />
                  <span className="text-muted-foreground group-data-selected/command-item:text-foreground/75">
                    查看全部 {formatTotal(hits.positions.total, hits.positions.capped)} 条体制内结果
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
            </>
          )}
          {kw && hits && hits.campus.total > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={`校招信息 · ${formatTotal(hits.campus.total, hits.campus.capped)} 条`}>
                {hits.campus.items.map((j) => (
                  <CommandItem
                    key={`campus-${j.id}`}
                    value={`campus-${j.id}`}
                    onSelect={() => pick('campus', j.id)}
                  >
                    <GraduationCap className="text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{j.company || '-'}</span>
                      <span className="block truncate text-xs text-muted-foreground group-data-selected/command-item:text-foreground/75">
                        {[j.positions, j.locations].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </CommandItem>
                ))}
                {hits.campus.total > hits.campus.items.length && (
                  <CommandItem value="campus-all" className="max-sm:min-h-11" onSelect={() => pickAll('campus')}>
                    <ArrowRight className="text-muted-foreground" />
                    <span className="text-muted-foreground group-data-selected/command-item:text-foreground/75">
                      查看全部 {formatTotal(hits.campus.total, hits.campus.capped)} 条校招结果
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
            </>
          )}
          {kw && hits && hits.bianzhi.total > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={`编制公告 · ${formatTotal(hits.bianzhi.total, hits.bianzhi.capped)} 条`}>
                {hits.bianzhi.items.map((j) => (
                  <CommandItem
                    key={`bianzhi-${j.id}`}
                    value={`bianzhi-${j.id}`}
                    onSelect={() => pick('bianzhi', j.id)}
                  >
                    <Briefcase className="text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{j.employer || '-'}</span>
                      <span className="block truncate text-xs text-muted-foreground group-data-selected/command-item:text-foreground/75">
                        {[j.category, j.province, j.job_type].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </CommandItem>
                ))}
                {hits.bianzhi.total > hits.bianzhi.items.length && (
                  <CommandItem value="bianzhi-all" className="max-sm:min-h-11" onSelect={() => pickAll('bianzhi')}>
                    <ArrowRight className="text-muted-foreground" />
                    <span className="text-muted-foreground group-data-selected/command-item:text-foreground/75">
                      查看全部 {formatTotal(hits.bianzhi.total, hits.bianzhi.capped)} 条编制结果
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
            </>
          )}
          {kw &&
            hits &&
            onOpenAll &&
            hits.positions.total + hits.campus.total + hits.bianzhi.total > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value="aggregate-all" className="max-sm:min-h-11" onSelect={pickAggregate}>
                    <LayoutList className="text-primary" />
                    <span>
                      查看全部结果（三板块聚合 ·{' '}
                      {(hits.positions.total + hits.campus.total + hits.bianzhi.total).toLocaleString()}
                      {hits.positions.capped || hits.campus.capped || hits.bianzhi.capped ? '+' : ''} 条）
                    </span>
                    <ArrowRight className="ml-auto text-muted-foreground" />
                  </CommandItem>
                </CommandGroup>
              </>
            )}
        </CommandList>
        {empty && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            三个板块均无「{kw}」的相关结果
            <span className="mt-1 block text-xs">
              建议：换更短的关键词（如只搜单位名或岗位名）；若在板块列表页有筛选，可清除筛选后再试
            </span>
            {/\s/.test(kw) && (
              <button
                type="button"
                className="mt-1.5 inline-flex min-h-11 cursor-pointer items-center rounded-full border border-primary/30 bg-primary/5 px-3 text-xs text-foreground/80 hover:bg-primary/10 sm:min-h-7"
                onClick={() => setQ(kw.replace(/\s+/g, ''))}
              >
                试试去掉空格：「{kw.replace(/\s+/g, '')}」
              </button>
            )}
            {getSynonyms(kw).map((syn) => (
              <button
                key={syn}
                type="button"
                className="ml-1.5 mt-1.5 inline-flex min-h-11 cursor-pointer items-center rounded-full border border-primary/30 bg-primary/5 px-3 text-xs text-foreground/80 hover:bg-primary/10 sm:min-h-7"
                onClick={() => setQ(syn)}
              >
                试试同义词：「{syn}」
              </button>
            ))}
            {synOff && expandKeyword(kw).added.length > 0 && (
              <button
                type="button"
                className="ml-1.5 mt-1.5 inline-flex min-h-11 cursor-pointer items-center rounded-full border border-primary/30 bg-primary/5 px-3 text-xs text-foreground/80 hover:bg-primary/10 sm:min-h-7"
                onClick={() => setSynOff(false)}
              >
                重新开启同义匹配（{expandKeyword(kw).added.join('、')}）
              </button>
            )}
            <span className="mt-3 block text-xs font-medium text-foreground/70">热门搜索</span>
            <span className="mt-1.5 flex flex-wrap justify-center gap-1.5">
              {HOT_SEARCHES.map((w) => (
                <button
                  key={w}
                  type="button"
                  className="min-h-11 cursor-pointer rounded-full border bg-muted/50 px-3 py-1 text-xs text-foreground/80 transition-colors hover:bg-muted hover:text-foreground sm:min-h-7"
                  onClick={() => setQ(w)}
                >
                  {w}
                </button>
              ))}
            </span>
          </div>
        )}
      </Command>
    </CommandDialog>
  )
}
