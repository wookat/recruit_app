import { t } from '@/lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { Check, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { takeApplyPending, type ApplyPending } from '@/lib/applyTracking'
import { getAppStatus, setAppStatus } from '@/lib/positionStore'
import { getBoardStatus, setBoardStatus } from '@/lib/boardFavorites'

const DISMISS_MS = 12000

function parseKey(key: string): { board: 'positions' | 'campus' | 'bianzhi'; id: number } | null {
  const [b, idStr] = key.split(':')
  const id = Number(idStr)
  if ((b === 'positions' || b === 'campus' || b === 'bianzhi') && id > 0) return { board: b, id }
  return null
}

/** 点原文链接跳出后回站的「投了吗？」底部 toast：每岗位只提示一次，已标记过状态的不提示。 */
export function ApplyPromptHost() {
  const [pending, setPending] = useState<ApplyPending | null>(null)
  const [done, setDone] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const scheduleDismiss = (ms = DISMISS_MS) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPending(null), ms)
  }

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return
      const p = takeApplyPending()
      if (!p) return
      const parsed = parseKey(p.key)
      if (!parsed) return
      const status =
        parsed.board === 'positions'
          ? getAppStatus(parsed.id)
          : getBoardStatus(parsed.board, parsed.id)
      if (status !== '未投递') return
      setDone(false)
      setPending(p)
      scheduleDismiss()
    }
    document.addEventListener('visibilitychange', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.clearTimeout(timer.current)
    }
  }, [])

  if (!pending) return null

  const markApplied = () => {
    const parsed = parseKey(pending.key)
    if (parsed) {
      if (parsed.board === 'positions') setAppStatus(parsed.id, '已投递')
      else setBoardStatus(parsed.board, parsed.id, '已投递')
    }
    setDone(true)
    scheduleDismiss(4000)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-1/2 z-[60] flex w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border bg-background px-3 py-2.5 text-sm shadow-lg md:bottom-6"
      onMouseEnter={() => window.clearTimeout(timer.current)}
      onMouseLeave={() => scheduleDismiss(4000)}
    >
      {done ? (
        <>
          <Check className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
          <span>{t("已标记为「已投递」，可在收藏面板跟踪进度")}</span>
        </>
      ) : (
        <>
          <Send className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="max-w-64 truncate">
            {pending.title ? `${pending.title}：` : ''}
            {t("投了吗？")}
          </span>
          <Button size="sm" className="h-8 gap-1 px-2.5 text-xs" onClick={markApplied}>
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {t("一键标记已投递")}
          </Button>
        </>
      )}
      <button
        type="button"
        aria-label={t("关闭")}
        className="-mr-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        onClick={() => setPending(null)}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
