import { RefreshCw, X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/** SW 检测到新版本时的刷新提示条：点击刷新触发 skipWaiting 并整页刷新。 */
export function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // 每 30 分钟主动检查一次新版本（每日部署场景）
      if (reg) setInterval(() => void reg.update(), 30 * 60 * 1000)
    },
  })

  if (!needRefresh) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-16 z-[70] mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-primary/30 bg-background/95 px-4 py-2 text-xs shadow-lg backdrop-blur md:bottom-4"
    >
      <span className="font-medium">新版本可用</span>
      <button
        type="button"
        className="inline-flex min-h-11 cursor-pointer items-center gap-1 font-semibold text-primary sm:min-h-0"
        onClick={() => void updateServiceWorker(true)}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        点击刷新
      </button>
      <button
        type="button"
        aria-label="暂不刷新"
        className="inline-flex min-h-11 cursor-pointer items-center text-muted-foreground hover:text-foreground sm:min-h-0"
        onClick={() => setNeedRefresh(false)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
