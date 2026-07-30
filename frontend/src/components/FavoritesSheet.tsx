import { useState } from 'react'
import type { Position } from '@/api'
import {
  APP_STATUSES,
  STATUS_COLORS,
  clearFavorites,
  setAppStatus,
  toggleFavorite,
  useAppStatuses,
  useFavorites,
  type AppStatus,
} from '@/lib/positionStore'
import { copyText, favoritesShareUrl } from '@/lib/clipboard'
import { PositionSheet } from './PositionSheet'
import { CompareButton } from './CompareButton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Building2, MapPin, Star, Trash2, Link2, Check } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
}

export function FavoritesSheet({ open, onClose }: Props) {
  const favorites = useFavorites()
  const statuses = useAppStatuses()
  const [selected, setSelected] = useState<Position | null>(null)
  const [copied, setCopied] = useState(false)

  const statusCounts = favorites.reduce<Record<string, number>>((acc, p) => {
    const s = statuses[p.id] || '未投递'
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})

  async function shareFavorites() {
    await copyText(favoritesShareUrl(favorites.map((p) => p.id)))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full max-w-2xl p-0 sm:max-w-md">
          <SheetHeader className="px-4 pt-6 sm:px-6">
            <SheetTitle className="flex items-center gap-2 text-lg">
              <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
              我的收藏
              <Badge variant="secondary">{favorites.length}</Badge>
              {favorites.length > 0 && (
                <span className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={shareFavorites}
                  >
                    {copied ? (
                      <>
                        <Check className="mr-1 h-3.5 w-3.5 text-green-600" />
                        已复制
                      </>
                    ) : (
                      <>
                        <Link2 className="mr-1 h-3.5 w-3.5" />
                        分享收藏夹
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={clearFavorites}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    清空
                  </Button>
                </span>
              )}
            </SheetTitle>
          </SheetHeader>
          {favorites.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-1 sm:px-6">
              {APP_STATUSES.filter((s) => statusCounts[s]).map((s) => (
                <span
                  key={s}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[s]}`}
                >
                  {s} {statusCounts[s]}
                </span>
              ))}
            </div>
          )}
          <ScrollArea className="h-[calc(100dvh-6.5rem)]">
            {favorites.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                暂无收藏，点击岗位旁的 ⭐ 收藏
              </div>
            ) : (
              <div className="divide-y">
                {favorites.map((p) => (
                  <div key={p.id} className="flex items-start gap-2 px-4 py-3 hover:bg-muted/50 sm:px-6">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(p)}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="text-[11px]">
                          {p.year}
                        </Badge>
                        <span className="line-clamp-1 text-sm font-medium">
                          {p.position_example || p.exam_type || '-'}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="inline-flex max-w-full items-center gap-1">
                          <Building2 className="h-3 w-3 shrink-0" />
                          <span className="truncate">{p.employer || '-'}</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {p.work_location || '-'}
                        </span>
                      </div>
                    </button>
                    <Select
                      value={statuses[p.id] || '未投递'}
                      onValueChange={(v) => setAppStatus(p.id, v as AppStatus)}
                    >
                      <SelectTrigger
                        size="sm"
                        className={`h-7 w-auto gap-1 border-none px-2 text-[11px] font-medium shadow-none ${STATUS_COLORS[(statuses[p.id] || '未投递') as AppStatus]}`}
                      >
                        {statuses[p.id] || '未投递'}
                      </SelectTrigger>
                      <SelectContent>
                        {APP_STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <CompareButton item={p} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="取消收藏"
                      onClick={() => toggleFavorite(p)}
                    >
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
      {selected && <PositionSheet item={selected} onClose={() => setSelected(null)} />}
    </>
  )
}
