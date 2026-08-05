import { t, tt } from '@/lib/i18n'
import { useMemo, useState } from 'react'
import { CalendarClock, Check, ClipboardCopy, Download, ImageIcon, Send, Sparkles, Star, TrendingUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { copyText } from '@/lib/clipboard'
import { canvasToBlob, renderWeeklyCard } from '@/lib/weeklyCard'
import { daysUntil, getEffectiveDeadline, parseSignupDeadline } from '@/lib/deadline'
import { getFavAddedMap } from '@/lib/favTimes'
import { useCampusFavorites, useBianzhiFavorites, useCampusMeta, useBianzhiMeta } from '@/lib/boardFavorites'
import { useAppStatusHistory, useFavorites, type StatusEvent } from '@/lib/positionStore'

const WEEK_MS = 7 * 86400_000
const ADVANCE_STATUSES = new Set(['待笔试', '待面试', 'OC/录用'])

function countEvents(histories: Record<number, StatusEvent[] | undefined>, since: number) {
  let applied = 0
  let advanced = 0
  for (const events of Object.values(histories)) {
    for (const e of events ?? []) {
      const t = new Date(e.at).getTime()
      if (Number.isNaN(t) || t < since) continue
      if (e.status === '已投递') applied += 1
      else if (ADVANCE_STATUSES.has(e.status)) advanced += 1
    }
  }
  return { applied, advanced }
}

/** 求职进度「本周小结」卡片：近 7 天收藏/投递/推进/即将截止，纯本地计算。 */
export function WeeklyDigest({ onClose }: { onClose: () => void }) {
  const favorites = useFavorites()
  const campusFavs = useCampusFavorites()
  const bianzhiFavs = useBianzhiFavorites()
  const statusHistory = useAppStatusHistory()
  const campusMeta = useCampusMeta()
  const bianzhiMeta = useBianzhiMeta()
  const [copied, setCopied] = useState(false)
  const [cardUrl, setCardUrl] = useState<string | null>(null)
  const [imgCopied, setImgCopied] = useState(false)
  const [imgCopyFail, setImgCopyFail] = useState(false)

  const digest = useMemo(() => {
    const now = Date.now()
    const since = now - WEEK_MS

    const favKeys = new Set([
      ...favorites.map((p) => `positions:${p.id}`),
      ...campusFavs.map((j) => `campus:${j.id}`),
      ...bianzhiFavs.map((j) => `bianzhi:${j.id}`),
    ])
    let newFavs = 0
    for (const [key, at] of Object.entries(getFavAddedMap())) {
      const t = new Date(at).getTime()
      if (!Number.isNaN(t) && t >= since && favKeys.has(key)) newFavs += 1
    }

    const posEvents = countEvents(statusHistory, since)
    const campusEvents = countEvents(
      Object.fromEntries(Object.entries(campusMeta).map(([id, m]) => [id, m.history])),
      since,
    )
    const bianzhiEvents = countEvents(
      Object.fromEntries(Object.entries(bianzhiMeta).map(([id, m]) => [id, m.history])),
      since,
    )
    const applied = posEvents.applied + campusEvents.applied + bianzhiEvents.applied
    const advanced = posEvents.advanced + campusEvents.advanced + bianzhiEvents.advanced

    const inWeek = (d: Date | null) => {
      if (!d) return false
      const n = daysUntil(d)
      return n >= 0 && n <= 7
    }
    const dueSoon =
      favorites.filter((p) => inWeek(parseSignupDeadline(p))).length +
      campusFavs.filter((j) => inWeek(getEffectiveDeadline(j))).length +
      bianzhiFavs.filter((j) => inWeek(getEffectiveDeadline(j))).length

    return { newFavs, applied, advanced, dueSoon }
  }, [favorites, campusFavs, bianzhiFavs, statusHistory, campusMeta, bianzhiMeta])

  const { newFavs, applied, advanced, dueSoon } = digest
  const empty = newFavs === 0 && applied === 0 && advanced === 0 && dueSoon === 0

  const cheer = advanced > 0
    ? t("状态在往前走，稳住节奏，上岸在望！")
    : applied > 0
      ? t("已投出去了，接下来准备笔试面试，加油！")
      : newFavs > 0
        ? t("心仪岗位已入库，别忘了按截止日期投出去！")
        : dueSoon > 0
          ? t("收藏里有岗位快截止了，抓紧投递！")
          : ''

  const fmt = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}`
  const rangeText = `${fmt(new Date(Date.now() - WEEK_MS))}-${fmt(new Date())}`
  const summaryText = tt`本周求职小结（${rangeText}）：新收藏 ${newFavs} · 投递 ${applied} · 状态推进 ${advanced}（笔试/面试/OC） · 即将截止 ${dueSoon}。${cheer}`

  const stats = [
    { icon: Star, label: t("新收藏"), value: newFavs },
    { icon: Send, label: t("投递"), value: applied },
    { icon: TrendingUp, label: t("状态推进"), value: advanced },
    { icon: CalendarClock, label: t("即将截止"), value: dueSoon },
  ]

  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">{t("本周小结")}</span>
        <span className="text-xs text-muted-foreground">{t("近 7 天 · 仅本机数据")}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("关闭本周小结")}
          className="ml-auto h-11 w-11 text-muted-foreground sm:h-6 sm:w-6"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {empty ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("本周还没有新动态——去收藏几个心仪岗位、标记投递状态，下周小结见分晓。")}{' '}</p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {stats.map((s) => (
              <div key={s.label} className="rounded-md bg-background px-1.5 py-2 text-center">
                <div className="flex items-center justify-center gap-1 text-base font-semibold tabular-nums">
                  {s.value}
                </div>
                <div className="mt-0.5 flex items-center justify-center gap-0.5 text-[11px] text-muted-foreground">
                  <s.icon className="h-3 w-3" />
                  {s.label}
                </div>
              </div>
            ))}
          </div>
          {cheer && <p className="mt-2 text-xs text-muted-foreground">{cheer}</p>}
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-auto min-h-11 w-full gap-1.5 text-xs sm:min-h-8"
            onClick={async () => {
              await copyText(summaryText)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            {copied ? t("已复制，去微信粘贴吧") : t("复制小结文本")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="mt-1.5 h-auto min-h-11 w-full gap-1.5 text-xs sm:min-h-8"
            onClick={() => {
              const canvas = renderWeeklyCard({
                rangeText,
                stats: stats.map((s) => ({ label: s.label, value: s.value })),
                cheer,
              })
              setCardUrl(canvas.toDataURL('image/png'))
              setImgCopied(false)
              setImgCopyFail(false)
            }}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {t("生成分享图片")}{' '}</Button>
          <Dialog open={!!cardUrl} onOpenChange={(o) => !o && setCardUrl(null)}>
            <DialogContent className="max-w-xs sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>{t("本周小结分享卡")}</DialogTitle>
                <DialogDescription>{t("长按图片保存，或用下方按钮保存/复制后发微信。")}</DialogDescription>
              </DialogHeader>
              {cardUrl && (
                <img src={cardUrl} alt={t("本周求职小结分享卡")} className="w-full rounded-lg border" />
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5 text-xs sm:min-h-9"
                  onClick={() => {
                    if (!cardUrl) return
                    const a = document.createElement('a')
                    a.href = cardUrl
                    a.download = tt`求职周报_${rangeText.replace(/[.-]/g, '')}.png`
                    a.click()
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("保存图片")}{' '}</Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5 text-xs sm:min-h-9"
                  onClick={async () => {
                    try {
                      const blob = await canvasToBlob(
                        renderWeeklyCard({
                          rangeText,
                          stats: stats.map((s) => ({ label: s.label, value: s.value })),
                          cheer,
                        }),
                      )
                      if (!blob) throw new Error('no blob')
                      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                      setImgCopied(true)
                      setImgCopyFail(false)
                      setTimeout(() => setImgCopied(false), 2000)
                    } catch {
                      setImgCopyFail(true)
                    }
                  }}
                >
                  {imgCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                  ) : (
                    <ClipboardCopy className="h-3.5 w-3.5" />
                  )}
                  {imgCopied ? t("已复制") : t("复制图片")}
                </Button>
              </div>
              {imgCopyFail && (
                <p className="text-xs text-muted-foreground">
                  {t("当前浏览器不支持复制图片，请长按图片保存或点「保存图片」。")}{' '}</p>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
