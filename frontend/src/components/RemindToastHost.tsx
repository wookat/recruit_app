import { t, tt } from '@/lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { BellRing, Check, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildPushItems, enablePush } from '@/lib/push'
import { getRemindDays } from '@/lib/reminderPref'
import { getFavorites } from '@/lib/positionStore'
import { getBianzhiFavorites, getCampusFavorites } from '@/lib/boardFavorites'
import { REMIND_CTA_EVENT } from '@/lib/remindCta'

/** 收藏有截止日期岗位后的全局 toast：引导开启截止推送提醒（每设备前 2 次）。 */
export function RemindToastHost() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'denied' | 'error'>('idle')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const show = () => {
      setState('idle')
      setOpen(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setOpen(false), 10000)
    }
    window.addEventListener(REMIND_CTA_EVENT, show)
    return () => {
      window.removeEventListener(REMIND_CTA_EVENT, show)
      window.clearTimeout(timer.current)
    }
  }, [])

  if (!open) return null

  const remindDays = getRemindDays()

  const activate = async () => {
    if (state === 'busy') return
    setState('busy')
    window.clearTimeout(timer.current)
    try {
      const items = buildPushItems(getFavorites(), getCampusFavorites(), getBianzhiFavorites())
      const result = await enablePush(remindDays, items)
      if (result === 'granted') setState('done')
      else if (result === 'denied') setState('denied')
      else setState('error')
    } catch {
      setState('error')
    }
    timer.current = window.setTimeout(() => setOpen(false), 6000)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-1/2 z-[60] flex w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border bg-background px-3 py-2.5 text-sm shadow-lg md:bottom-6"
    >
      {state === 'done' ? (
        <>
          <Check className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
          <span>{tt`已开启：截止前 ${remindDays} 天提醒你报名（关闭网页也能收到）`}</span>
        </>
      ) : state === 'denied' || state === 'error' ? (
        <>
          <BellRing className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span className="max-w-72">
            {state === 'denied'
              ? t("浏览器拒绝了通知权限，可在地址栏站点设置中重新允许后到收藏面板开启")
              : t("开启失败，可稍后到收藏面板重试")}
          </span>
        </>
      ) : (
        <>
          <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" />
          <span>{t("已收藏")}</span>
          <Button
            size="sm"
            className="h-8 gap-1 px-2.5 text-xs"
            aria-busy={state === 'busy'}
            title={tt`截止前 ${remindDays} 天提醒你报名（关闭网页也能收到）`}
            onClick={activate}
          >
            <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
            {t("开启截止提醒")}
          </Button>
        </>
      )}
      <button
        type="button"
        aria-label={t("关闭")}
        className="-mr-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        onClick={() => setOpen(false)}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
