import { t } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

/** 网络断开时显示顶栏横幅，恢复后自动消失。 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => !navigator.onLine)

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      className="sticky top-0 z-[60] flex items-center justify-center gap-1.5 bg-amber-500/95 px-3 py-1.5 text-xs font-medium text-amber-950 dark:bg-amber-600/95 dark:text-amber-50"
    >
      <WifiOff className="h-3.5 w-3.5" />
      {t("离线模式 · 数据可能不是最新（收藏与最近浏览仍可用）")}{' '}</div>
  )
}
