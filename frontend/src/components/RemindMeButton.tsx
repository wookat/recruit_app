import { t, tt } from '@/lib/i18n'
import { useState } from 'react'
import { BellRing, Check, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildPushItems, enablePush, isPushSupported, usePushEnabled } from '@/lib/push'
import { useRemindDays } from '@/lib/reminderPref'
import { getFavorites } from '@/lib/positionStore'
import { getBianzhiFavorites, getCampusFavorites } from '@/lib/boardFavorites'
import { emitRemindConfirm, suppressRemindCta } from '@/lib/remindCta'
import { daysUntil } from '@/lib/deadline'

interface Props {
  /** 岗位报名截止日期；无截止或已过期不渲染。 */
  deadline: Date | null | undefined
  favActive: boolean
  onFavToggle: () => void
}

/** 详情面板「提醒我」：收藏该岗位并开启截止前推送提醒。 */
export function RemindMeButton({ deadline, favActive, onFavToggle }: Props) {
  const remindDays = useRemindDays()
  const pushEnabled = usePushEnabled()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'denied' | 'error'>('idle')
  if (!deadline || daysUntil(deadline) < 0 || !isPushSupported()) return null

  const done = state === 'done' || (favActive && pushEnabled)

  const click = async () => {
    if (state === 'busy' || done) return
    // 权限已授予时乐观更新按钮态并弹确认 toast，订阅/上报失败再回退提示
    const optimistic = Notification.permission === 'granted'
    setState(optimistic ? 'done' : 'busy')
    if (optimistic) emitRemindConfirm()
    if (!favActive) suppressRemindCta(onFavToggle)
    try {
      const items = buildPushItems(getFavorites(), getCampusFavorites(), getBianzhiFavorites())
      const result = await enablePush(remindDays, items)
      if (result === 'granted') setState('done')
      else if (result === 'denied') setState('denied')
      else setState('error')
    } catch {
      setState('error')
    }
  }

  return (
    <>
      <Button
        variant={done ? 'secondary' : 'outline'}
        size="sm"
        className="h-8 gap-1 px-2.5 text-xs"
        aria-busy={state === 'busy'}
        title={tt`截止前 ${remindDays} 天提醒你报名`}
        onClick={click}
      >
        {done ? (
          <Check className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
        ) : (
          <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {done ? t("已设提醒") : t("提醒我")}
      </Button>
      {!done && (
        <span className="text-[11px] text-muted-foreground">{tt`截止前 ${remindDays} 天提醒你报名`}</span>
      )}
      {(state === 'denied' || state === 'error') && (
        <span
          role="alert"
          className="flex w-full items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {state === 'denied'
            ? t("已收藏。浏览器拒绝了通知权限，可在地址栏站点设置中重新允许后再点「提醒我」")
            : t("已收藏。提醒开启失败，请稍后再点一次「提醒我」重试")}
        </span>
      )}
    </>
  )
}
