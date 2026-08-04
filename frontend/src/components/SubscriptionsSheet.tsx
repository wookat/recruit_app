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
        <p className="text-xs text-muted-foreground">
          「上新」= 当前结果数对比你保存该筛选时的结果数；每次打开站点会自动检查。
        </p>
        {entries.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              还没有订阅。去任一板块设置好筛选条件（如省份+关键词），点「保存当前筛选」即可订阅，之后有匹配的新岗位会在这里和今日速览提示。
            </p>
            <div className="flex flex-wrap gap-2">
              {(['positions', 'campus', 'bianzhi'] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  className="min-h-11 cursor-pointer rounded-md border border-primary/30 bg-primary/5 px-3 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 sm:min-h-9"
                  onClick={() => {
                    closeSubscriptionsPanel()
                    window.location.href =
                      scope === 'positions'
                        ? window.location.pathname
                        : `${window.location.pathname}?board=${scope}`
                  }}
                >
                  去{SCOPE_LABELS[scope]}板块设置 →
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <ul className="max-h-[55vh] space-y-1.5 overflow-y-auto">
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
                        <span className="shrink-0 rounded-sm bg-red-500/15 px-1.5 text-[11px] font-medium text-red-600 dark:text-red-400">
                          +{n} 新
                        </span>
                      )}
                      <span className="shrink-0 text-[11px] text-primary">
                        {n > 0 ? '查看新增 →' : '查看 →'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
              管理（重命名/删除）在各板块筛选区：
              {(['positions', 'campus', 'bianzhi'] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  className="min-h-11 cursor-pointer px-1 font-medium text-primary underline-offset-2 hover:underline sm:min-h-6"
                  onClick={() => {
                    closeSubscriptionsPanel()
                    window.location.href =
                      scope === 'positions'
                        ? window.location.pathname
                        : `${window.location.pathname}?board=${scope}`
                  }}
                >
                  {SCOPE_LABELS[scope]}
                </button>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
