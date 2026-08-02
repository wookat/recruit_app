import { Bookmark } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  closeSubscriptionsPanel,
  markSavedFilterSeen,
  useSavedNews,
  useSubscriptionsPanelOpen,
} from '@/lib/savedNews'
import { getSavedFilters, getSavedQueries } from '@/lib/storage'
import { paramsToQueryString } from '@/lib/urlFilters'

const SCOPE_LABELS: Record<string, string> = {
  positions: '体制内',
  campus: '校招',
  bianzhi: '编制',
}

interface Entry {
  scope: string
  name: string
  href: string
}

function collectEntries(): Entry[] {
  const out: Entry[] = []
  for (const f of getSavedFilters()) {
    out.push({
      scope: 'positions',
      name: f.name,
      href: `${window.location.pathname}?${paramsToQueryString(f.params)}`,
    })
  }
  for (const scope of ['campus', 'bianzhi'] as const) {
    for (const f of getSavedQueries(scope)) {
      const q = new URLSearchParams(f.query)
      q.set('board', scope)
      out.push({ scope, name: f.name, href: `${window.location.pathname}?${q.toString()}` })
    }
  }
  return out
}

/** 「我的订阅」面板：汇总三板块常用筛选与上新计数，点击整体应用（URL 恢复）。 */
export function SubscriptionsSheet() {
  const open = useSubscriptionsPanelOpen()
  const news = useSavedNews()
  if (!open) return null

  const entries = collectEntries()

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeSubscriptionsPanel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Bookmark className="h-4 w-4 text-primary" />
            我的订阅（常用筛选）
          </DialogTitle>
        </DialogHeader>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            还没有订阅：在任一板块设置筛选后点「保存当前筛选」，有上新会在这里提示。
          </p>
        ) : (
          <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto">
            {entries.map((e) => {
              const n = news.counts[`${e.scope}|${e.name}`] ?? 0
              return (
                <li key={`${e.scope}|${e.name}`}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                    onClick={() => {
                      markSavedFilterSeen(e.scope, e.name)
                      closeSubscriptionsPanel()
                      window.location.href = e.href
                    }}
                  >
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {SCOPE_LABELS[e.scope] ?? e.scope}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    {n > 0 && (
                      <span className="shrink-0 rounded-full bg-red-500/15 px-1.5 text-[11px] font-medium text-red-600 dark:text-red-400">
                        +{n} 新
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
