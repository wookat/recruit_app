import { useEffect, useState } from 'react'
import { ArrowRight, Briefcase, GraduationCap, Landmark, SearchX } from 'lucide-react'
import {
  fetchBianzhiJobs,
  fetchCampusJobs,
  fetchPositions,
  type BianzhiJob,
  type CampusJob,
  type Position,
} from '@/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Highlight } from '@/components/Highlight'
import { stripOrgPrefix } from '@/lib/orgPrefix'
import { expandKeyword } from '@/lib/synonyms'
import type { SearchBoard } from '@/components/GlobalSearch'

const SHOW = 10

interface Hits {
  positions: { total: number; items: Position[] }
  campus: { total: number; items: CampusJob[] }
  bianzhi: { total: number; items: BianzhiJob[] }
}

interface Props {
  keyword: string
  onOpenBoard: (board: SearchBoard, keyword: string) => void
  onOpenJob: (board: SearchBoard, id: number, keyword: string) => void
}

interface RowItem {
  key: string
  title: string
  sub: string
}

function SectionBlock({
  icon: Icon,
  title,
  total,
  boardLabel,
  items,
  keyword,
  onMore,
  onItem,
}: {
  icon: typeof Landmark
  title: string
  total: number
  boardLabel: string
  items: RowItem[]
  keyword: string
  onMore: () => void
  onItem: (key: string) => void
}) {
  if (total === 0) return null
  return (
    <section className="rounded-xl border bg-background p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{total.toLocaleString()} 条命中</span>
      </div>
      <ul className="divide-y">
        {items.map((it) => (
          <li key={it.key}>
            <button
              type="button"
              className="flex w-full min-h-11 cursor-pointer flex-col items-start gap-0.5 py-2 text-left transition-colors hover:bg-muted/50"
              onClick={() => onItem(it.key)}
            >
              <span className="line-clamp-1 text-sm">
                <Highlight text={it.title} query={keyword} />
              </span>
              {it.sub && (
                <span className="line-clamp-1 text-xs text-muted-foreground">
                  <Highlight text={it.sub} query={keyword} />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {total > items.length && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2 h-auto min-h-11 w-full gap-1.5 text-xs sm:min-h-8"
          onClick={onMore}
        >
          查看全部 {total.toLocaleString()} 条{boardLabel}结果
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </section>
  )
}

/** 聚合搜索结果视图（?board=search&q=）：三板块命中分节展示，URL 可分享。 */
export function SearchResultsPage({ keyword, onOpenBoard, onOpenJob }: Props) {
  const [hits, setHits] = useState<Hits | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const kw = keyword.trim()
    if (!kw) {
      setHits(null)
      setLoading(false)
      return
    }
    const sendKw = expandKeyword(kw).expanded
    let cancelled = false
    setLoading(true)
    Promise.allSettled([
      fetchPositions({ keyword: sendKw, page: 1, page_size: SHOW }),
      fetchCampusJobs({ keyword: sendKw, page: 1, page_size: SHOW }),
      fetchBianzhiJobs({ keyword: sendKw, page: 1, page_size: SHOW }),
    ]).then(([p, c, b]) => {
      if (cancelled) return
      setHits({
        positions:
          p.status === 'fulfilled' ? { total: p.value.total, items: p.value.items } : { total: 0, items: [] },
        campus:
          c.status === 'fulfilled' ? { total: c.value.total, items: c.value.items } : { total: 0, items: [] },
        bianzhi:
          b.status === 'fulfilled' ? { total: b.value.total, items: b.value.items } : { total: 0, items: [] },
      })
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [keyword])

  const kw = keyword.trim()
  const grandTotal = hits ? hits.positions.total + hits.campus.total + hits.bianzhi.total : 0

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">「{kw}」的搜索结果</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {loading ? '正在搜索三个板块…' : `三板块共命中 ${grandTotal.toLocaleString()} 条 · 链接可直接分享`}
        </p>
      </div>
      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      )}
      {!loading && hits && grandTotal === 0 && (
        <div className="rounded-xl border bg-background px-4 py-10 text-center text-sm text-muted-foreground">
          <SearchX className="mx-auto mb-2 h-8 w-8 opacity-50" />
          三个板块均无「{kw}」的相关结果
          <span className="mt-1 block text-xs">建议：换更短的关键词（如只搜单位名或岗位名），或试试同义词</span>
        </div>
      )}
      {!loading && hits && (
        <>
          <SectionBlock
            icon={Landmark}
            title="体制内岗位"
            boardLabel="体制内"
            total={hits.positions.total}
            keyword={kw}
            items={hits.positions.items.map((p) => ({
              key: String(p.id),
              title: p.position_example ? stripOrgPrefix(p.position_example, p.employer) : p.exam_type || '-',
              sub: [p.employer, p.work_location].filter(Boolean).join(' · '),
            }))}
            onMore={() => onOpenBoard('positions', kw)}
            onItem={(key) => onOpenJob('positions', Number(key), kw)}
          />
          <SectionBlock
            icon={GraduationCap}
            title="校招信息"
            boardLabel="校招"
            total={hits.campus.total}
            keyword={kw}
            items={hits.campus.items.map((j) => ({
              key: String(j.id),
              title: j.company || '-',
              sub: [j.positions, j.locations].filter(Boolean).join(' · '),
            }))}
            onMore={() => onOpenBoard('campus', kw)}
            onItem={(key) => onOpenJob('campus', Number(key), kw)}
          />
          <SectionBlock
            icon={Briefcase}
            title="编制公告"
            boardLabel="编制"
            total={hits.bianzhi.total}
            keyword={kw}
            items={hits.bianzhi.items.map((j) => ({
              key: String(j.id),
              title: j.employer || j.job_type || '-',
              sub: [j.category, j.province, j.job_type].filter(Boolean).join(' · '),
            }))}
            onMore={() => onOpenBoard('bianzhi', kw)}
            onItem={(key) => onOpenJob('bianzhi', Number(key), kw)}
          />
        </>
      )}
    </div>
  )
}
