import { useEffect, useState } from 'react'
import { ArrowRight, Briefcase, GraduationCap, Landmark } from 'lucide-react'
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

  useEffect(() => {
    if (!open) {
      setQ('')
      setHits(null)
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
    onClose()
    onOpenJob(board, id, kw)
  }
  const pickAll = (board: SearchBoard) => {
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
        <CommandList className="sm:max-h-96 max-sm:max-h-[calc(100dvh-64px)]">
          {!kw && (
            <div role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">
              输入关键词，同时搜索 体制内 / 校招 / 编制 三个板块
              <span className="mt-1 block text-xs">Ctrl K 随时打开 · 上下键选择 · 回车直达详情</span>
            </div>
          )}
          {kw && loading && !hits && (
            <div role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">
              搜索中…
            </div>
          )}
          {empty && (
            <div role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">
              三个板块均无「{kw}」的相关结果
              <span className="mt-1 block text-xs">
                建议：换更短的关键词（如只搜单位名或岗位名）；若在板块列表页有筛选，可清除筛选后再试
              </span>
            </div>
          )}
          {kw && hits && hits.positions.total > 0 && (
            <CommandGroup heading={`体制内岗位（${hits.positions.total.toLocaleString()}）`}>
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
                    <span className="block truncate text-xs text-muted-foreground">
                      {[p.employer, p.work_location].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </CommandItem>
              ))}
              {hits.positions.total > hits.positions.items.length && (
                <CommandItem value="positions-all" className="max-sm:min-h-11" onSelect={() => pickAll('positions')}>
                  <ArrowRight className="text-muted-foreground" />
                  <span className="text-muted-foreground">
                    查看全部 {hits.positions.total.toLocaleString()} 条体制内结果
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          )}
          {kw && hits && hits.campus.total > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={`校招信息（${hits.campus.total.toLocaleString()}）`}>
                {hits.campus.items.map((j) => (
                  <CommandItem
                    key={`campus-${j.id}`}
                    value={`campus-${j.id}`}
                    onSelect={() => pick('campus', j.id)}
                  >
                    <GraduationCap className="text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{j.company || '-'}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[j.positions, j.locations].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </CommandItem>
                ))}
                {hits.campus.total > hits.campus.items.length && (
                  <CommandItem value="campus-all" className="max-sm:min-h-11" onSelect={() => pickAll('campus')}>
                    <ArrowRight className="text-muted-foreground" />
                    <span className="text-muted-foreground">
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
              <CommandGroup heading={`编制公告（${hits.bianzhi.total.toLocaleString()}）`}>
                {hits.bianzhi.items.map((j) => (
                  <CommandItem
                    key={`bianzhi-${j.id}`}
                    value={`bianzhi-${j.id}`}
                    onSelect={() => pick('bianzhi', j.id)}
                  >
                    <Briefcase className="text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{j.employer || '-'}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[j.category, j.province, j.job_type].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </CommandItem>
                ))}
                {hits.bianzhi.total > hits.bianzhi.items.length && (
                  <CommandItem value="bianzhi-all" className="max-sm:min-h-11" onSelect={() => pickAll('bianzhi')}>
                    <ArrowRight className="text-muted-foreground" />
                    <span className="text-muted-foreground">
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
