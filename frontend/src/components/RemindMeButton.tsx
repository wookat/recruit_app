import { t, tt } from '@/lib/i18n'
import { useState } from 'react'
import { BellRing, Check, ChevronDown, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { buildPushItems, enablePush, isPushSupported, syncPushItems, usePushEnabled } from '@/lib/push'
import { formatNodes, REMIND_NODE_OPTIONS, useRemindNodes } from '@/lib/reminderPref'
import { setReminder, setReminderNodes, useReminders } from '@/lib/reminders'
import { getFavorites } from '@/lib/positionStore'
import { getBianzhiFavorites, getCampusFavorites } from '@/lib/boardFavorites'
import { emitRemindConfirm, suppressRemindCta } from '@/lib/remindCta'
import { daysUntil } from '@/lib/deadline'

interface Props {
  /** 岗位报名截止日期；无截止或已过期不渲染。 */
  deadline: Date | null | undefined
  favActive: boolean
  onFavToggle: () => void
  /** 岗位 key（board:id）；传入时提醒按岗位记录节点，可单独调整。 */
  jobKey?: string
  /** 岗位标题（单位/公司名），用于「我的提醒」列表。 */
  jobTitle?: string
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 详情面板「提醒我」：收藏该岗位并开启截止前推送提醒，可调提醒节点（截止前 1/3/7 天）。 */
export function RemindMeButton({ deadline, favActive, onFavToggle, jobKey, jobTitle }: Props) {
  const defaultNodes = useRemindNodes()
  const reminders = useReminders()
  const pushEnabled = usePushEnabled()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'denied' | 'error'>('idle')
  const [nodesOpen, setNodesOpen] = useState(false)
  if (!deadline || daysUntil(deadline) < 0 || !isPushSupported()) return null

  const entry = jobKey ? reminders.find((e) => e.key === jobKey) : undefined
  const done = state === 'done' || (favActive && pushEnabled && (!jobKey || !!entry))
  const nodes = entry?.nodes ?? defaultNodes

  const syncItems = () =>
    void syncPushItems(buildPushItems(getFavorites(), getCampusFavorites(), getBianzhiFavorites()))

  const toggleNode = (n: number) => {
    if (!jobKey) return
    if (entry) {
      setReminderNodes(jobKey, nodes.includes(n) ? nodes.filter((x) => x !== n) : [...nodes, n])
    } else {
      setReminder(jobKey, jobTitle ?? '', fmtDate(deadline), nodes.includes(n) ? nodes.filter((x) => x !== n) : [...nodes, n])
    }
    syncItems()
  }

  const click = async () => {
    if (state === 'busy' || done) return
    // 权限已授予时乐观更新按钮态并弹确认 toast，订阅/上报失败再回退提示
    const optimistic = Notification.permission === 'granted'
    setState(optimistic ? 'done' : 'busy')
    if (optimistic) emitRemindConfirm()
    if (!favActive) suppressRemindCta(onFavToggle)
    if (jobKey) setReminder(jobKey, jobTitle ?? '', fmtDate(deadline))
    try {
      const items = buildPushItems(getFavorites(), getCampusFavorites(), getBianzhiFavorites())
      const result = await enablePush(items)
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
        title={tt`截止前 ${formatNodes(nodes)} 天提醒你报名`}
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
        <span className="text-[11px] text-muted-foreground">{tt`截止前 ${formatNodes(nodes)} 天提醒你报名`}</span>
      )}
      {done && jobKey && (
        <button
          type="button"
          aria-expanded={nodesOpen}
          className="inline-flex min-h-8 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setNodesOpen((v) => !v)}
        >
          {tt`截止前 ${formatNodes(nodes)} 天`}
          <ChevronDown className={cn('h-3 w-3 transition-transform', nodesOpen && 'rotate-180')} aria-hidden="true" />
        </button>
      )}
      {done && jobKey && nodesOpen && (
        <span className="flex w-full flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {t("提醒节点")}
          {REMIND_NODE_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={nodes.includes(n)}
              onClick={() => toggleNode(n)}
              className={cn(
                'min-h-8 cursor-pointer rounded-md border px-2 py-0.5 transition-colors',
                nodes.includes(n)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {tt`前 ${n} 天`}
            </button>
          ))}
        </span>
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
