import { t, tt } from '@/lib/i18n'
import { Briefcase, GraduationCap, History, Landmark, Trash2, X } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import {
  clearViewHistory,
  removeViewHistory,
  useViewHistory,
  type HistoryBoard,
} from '@/lib/viewHistory'

const BOARD_LABELS: Record<HistoryBoard, string> = {
  positions: t("体制内"),
  campus: t("校招"),
  bianzhi: t("编制"),
}

const BOARD_ICONS: Record<HistoryBoard, typeof Landmark> = {
  positions: Landmark,
  campus: GraduationCap,
  bianzhi: Briefcase,
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return t("刚刚")
  if (min < 60) return tt`${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return tt`${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return tt`${d} 天前`
  return new Date(iso).toLocaleDateString()
}

interface Props {
  open: boolean
  onClose: () => void
  /** 点击条目回到对应板块详情 */
  onOpenJob: (board: HistoryBoard, id: number) => void
}

/** 最近浏览面板：本地最近查看的岗位（最多 30 条，仅存本机）。 */
export function ViewHistorySheet({ open, onClose, onOpenJob }: Props) {
  const history = useViewHistory()

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full max-w-2xl p-0 data-[side=right]:w-full sm:max-w-md">
        <SheetHeader className="space-y-1.5 px-4 pt-6 sm:px-6">
          <SheetTitle className="flex items-center gap-2 pr-8 text-lg">
            <History className="h-5 w-5 text-primary" />
            {t("最近浏览")}{' '}{history.length > 0 && <Badge variant="secondary">{history.length}</Badge>}
          </SheetTitle>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("记录最近查看的")}{' '}{history.length > 0 ? t("岗位") : t("岗位（最多 30 条）")}{t("，仅保存在本机")}</span>
            {history.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 min-h-11 gap-1 px-2 text-xs sm:min-h-7"
                onClick={clearViewHistory}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("清空")}{' '}</Button>
            )}
          </div>
        </SheetHeader>
        <ScrollArea className="h-[calc(100dvh-120px)] px-4 pb-6 sm:px-6">
          {history.length === 0 ? (
            <EmptyState
              icon={History}
              title={t("还没有浏览记录")}
              description={t("点开任意岗位详情后，会在这里留下最近 30 条记录，方便随时回看")}
            />
          ) : (
            <ul className="space-y-1.5 py-2">
              {history.map((e) => {
                const Icon = BOARD_ICONS[e.board]
                return (
                  <li key={`${e.board}-${e.id}`} className="group flex items-center gap-2">
                    <button
                      type="button"
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
                      onClick={() => {
                        onClose()
                        onOpenJob(e.board, e.id)
                      }}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{e.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {BOARD_LABELS[e.board]} · {timeAgo(e.at)}
                        </span>
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 text-muted-foreground sm:h-8 sm:w-8"
                      aria-label={tt`删除「${e.title}」的浏览记录`}
                      onClick={() => removeViewHistory(e.board, e.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
