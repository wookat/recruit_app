import { useEffect, useState } from 'react'
import { ArrowRight, Briefcase, Clock, GraduationCap, Landmark, X } from 'lucide-react'
import {
  fetchBianzhiJobs,
  fetchCampusJobs,
  fetchPositions,
  type BianzhiJob,
  type CampusJob,
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
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  removeRecentSearch,
} from '@/lib/storage'

export type SearchBoard = 'positions' | 'campus' | 'bianzhi'

interface BoardHits {
  positions: { total: number; items: Position[] }
  campus: { total: number; items: CampusJob[] }
  bianzhi: { total: number; items: BianzhiJob[] }
}

interface Props {
  open: boolean
  onClose: () => void
  onOpenBoard: (board: SearchBoard, keyword: string) => void
  onOpenJob: (board: SearchBoard, id: number, keyword: string) => void
}

const SHOW = 5

export function GlobalSearch({ open, onClose, onOpenBoard, onOpenJob }: Props) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<BoardHits | null>(null)
  const [loading, setLoading] = useState(false)
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    if (!open) {
      setQ('')
      setHits(null)
    } else {
      setRecent(getRecentSearches())
    }
  }, [open])

  useEffect(() => {
    const kw = q.trim()
    if (!kw) {
      setHits(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      Promise.allSettled([
        fetchPositions({ keyword: kw, page: 1, page_size: SHOW }),
        fetchCampusJobs({ keyword: kw, page: 1, page_size: SHOW }),
        fetchBianzhiJobs({ keyword: kw, page: 1, page_size: SHOW }),
      ]).then(([p, c, b]) => {
        if (cancelled) return
        setHits({
          positions:
            p.status === 'fulfilled'
              ? { total: p.value.total, items: p.value.items }
              : { total: 0, items: [] },
          campus:
            c.status === 'fulfilled'
              ? { total: c.value.total, items: c.value.items }
              : { total: 0, items: [] },
          bianzhi:
            b.status === 'fulfilled'
              ? { total: b.value.total, items: b.value.items }
              : { total: 0, items: [] },
        })
        setLoading(false)
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q])

  const kw = q.trim()
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

  return (
    <CommandDialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="全站搜索"
      description="同时搜索体制内、校招、编制三个板块"
      showCloseButton
      className="max-sm:inset-0 max-sm:top-0 max-sm:h-dvh max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none!"
    >
      <Command shouldFilter={false} className="max-sm:h-full">
        <CommandInput
          placeholder="搜索岗位 / 单位 / 公司…（同时搜三板块）"
          value={q}
          onValueChange={setQ}
        />
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
              {recent.map((k) => (
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
        {empty && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            三个板块均无「{kw}」的相关结果
            <span className="mt-1 block text-xs">
              建议：换更短的关键词（如只搜单位名或岗位名）；若在板块列表页有筛选，可清除筛选后再试
            </span>
          </div>
        )}
        <CommandList className="sm:max-h-96 max-sm:max-h-[calc(100dvh-64px)]">
          {kw && hits && hits.positions.total > 0 && (
            <CommandGroup heading={`体制内岗位 · ${hits.positions.total.toLocaleString()} 条`}>
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
                    查看全部 {hits.positions.total.toLocaleString()} 条体制内结果
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          )}
          {kw && hits && hits.campus.total > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={`校招信息 · ${hits.campus.total.toLocaleString()} 条`}>
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
                      查看全部 {hits.campus.total.toLocaleString()} 条校招结果
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
            </>
          )}
          {kw && hits && hits.bianzhi.total > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={`编制公告 · ${hits.bianzhi.total.toLocaleString()} 条`}>
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
                      查看全部 {hits.bianzhi.total.toLocaleString()} 条编制结果
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
