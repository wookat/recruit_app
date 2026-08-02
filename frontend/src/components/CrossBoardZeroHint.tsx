import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { fetchBianzhiJobs, fetchCampusJobs, fetchPositions } from '@/api'

type Board = 'positions' | 'campus' | 'bianzhi'

const BOARD_LABELS: Record<Board, string> = {
  positions: '体制内岗位',
  campus: '校招信息',
  bianzhi: '编制公告',
}

const FETCH_TOTAL: Record<Board, (kw: string) => Promise<number>> = {
  positions: (kw) => fetchPositions({ keyword: kw, page: 1, page_size: 1 }).then((r) => r.total),
  campus: (kw) => fetchCampusJobs({ keyword: kw, page: 1, page_size: 1 }).then((r) => r.total),
  bianzhi: (kw) => fetchBianzhiJobs({ keyword: kw, page: 1, page_size: 1 }).then((r) => r.total),
}

/** 列表 0 结果时提示其余两个板块的关键词命中数，点击带关键词切板块。 */
export function CrossBoardZeroHint({
  from,
  keyword,
  onOpen,
}: {
  from: Board
  keyword: string
  onOpen: (board: Board, keyword: string) => void
}) {
  const kw = keyword.trim()
  const others = (Object.keys(BOARD_LABELS) as Board[]).filter((b) => b !== from)
  const [totals, setTotals] = useState<Partial<Record<Board, number>>>({})

  useEffect(() => {
    if (!kw) {
      setTotals({})
      return
    }
    let cancelled = false
    Promise.allSettled(others.map((b) => FETCH_TOTAL[b](kw))).then((results) => {
      if (cancelled) return
      const next: Partial<Record<Board, number>> = {}
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') next[others[i]] = r.value
      })
      setTotals(next)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kw, from])

  if (!kw) return null
  const hits = others.filter((b) => (totals[b] ?? 0) > 0)
  if (hits.length === 0) return null

  return (
    <div className="space-y-2">
      {hits.map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => onOpen(b, kw)}
          className="flex w-full min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed bg-background px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-h-0"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span>
            {BOARD_LABELS[b]}中另有{' '}
            <span className="font-semibold text-foreground">
              {(totals[b] ?? 0).toLocaleString()}
            </span>{' '}
            条与「{kw}」相关，点击查看 →
          </span>
        </button>
      ))}
    </div>
  )
}
