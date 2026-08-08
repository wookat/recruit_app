import { t, tt } from '@/lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { BellRing, Check, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildPushItems, enablePush } from '@/lib/push'
import { formatNodes, getRemindNodes } from '@/lib/reminderPref'
import { getFavorites } from '@/lib/positionStore'
import { getBianzhiFavorites, getCampusFavorites } from '@/lib/boardFavorites'
import { REMIND_CONFIRM_EVENT, REMIND_CTA_EVENT } from '@/lib/remindCta'
import { isWeChat } from '@/lib/wechat'

const DISMISS_MS = 10000

/** 收藏有截止日期岗位后的全局 toast：引导开启截止推送提醒（每设备前 2 次）；
 * 也承接「提醒我」的开启成功确认。hover 时暂停自动消失。 */
export function RemindToastHost() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'denied' | 'timeout' | 'error'>('idle')
  const timer = useRef<number | undefined>(undefined)

  const scheduleDismiss = (ms = DISMISS_MS) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(false), ms)
  }

  useEffect(() => {
    const show = () => {
      setState('idle')
      setOpen(true)
      scheduleDismiss()
    }
    const confirm = () => {
      setState('done')
      setOpen(true)
      scheduleDismiss()
    }
    window.addEventListener(REMIND_CTA_EVENT, show)
    window.addEventListener(REMIND_CONFIRM_EVENT, confirm)
    return () => {
      window.removeEventListener(REMIND_CTA_EVENT, show)
      window.removeEventListener(REMIND_CONFIRM_EVENT, confirm)
      window.clearTimeout(timer.current)
    }
  }, [])

  if (!open) return null

  const wechat = isWeChat()
  const remindNodes = formatNodes(getRemindNodes())

  const activate = async () => {
    if (state === 'busy') return
    setState('busy')
    window.clearTimeout(timer.current)
    try {
      const items = buildPushItems(getFavorites(), getCampusFavorites(), getBianzhiFavorites())
      const result = await enablePush(items)
      if (result === 'granted') setState('done')
      else if (result === 'denied') setState('denied')
      else if (result === 'timeout') setState('timeout')
      else setState('error')
    } catch {
      setState('error')
    }
    scheduleDismiss()
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-1/2 z-[60] flex w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border bg-background px-3 py-2.5 text-sm shadow-lg md:bottom-6"
      onMouseEnter={() => window.clearTimeout(timer.current)}
      onMouseLeave={() => scheduleDismiss(4000)}
    >
      {state === 'done' ? (
        <>
          <Check className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
          <span>{tt`已开启：截止前 ${remindNodes} 天提醒你报名（关闭网页也能收到）`}</span>
        </>
      ) : state === 'denied' || state === 'timeout' || state === 'error' ? (
        <>
          <BellRing className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span className="max-w-72">
            {state === 'denied'
              ? t("浏览器拒绝了通知权限，可在地址栏站点设置中重新允许后到收藏面板开启")
              : state === 'timeout'
                ? t("推送暂不可用，已保存到我的提醒（收藏面板可查看）")
                : t("开启失败，可稍后到收藏面板重试")}
          </span>
        </>
      ) : wechat ? (
        <>
          <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" />
          <span className="max-w-72">{t("已收藏。微信内暂不支持推送提醒，可在浏览器打开本站后开启")}</span>
        </>
      ) : (
        <>
          <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" />
          <span>{t("已收藏")}</span>
          <Button
            size="sm"
            className="h-8 gap-1 px-2.5 text-xs"
            aria-busy={state === 'busy'}
            title={tt`截止前 ${remindNodes} 天提醒你报名（关闭网页也能收到）`}
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
