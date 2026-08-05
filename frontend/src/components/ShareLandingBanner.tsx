import { t } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { Share2 } from 'lucide-react'
import { clearShareLanding, isShareLanding } from '@/lib/jobDeepLink'

/** 分享深链直达详情时的轻提示条：仅首次深链场景显示，关闭详情后不再出现。 */
export function ShareLandingBanner({ jobKey, onBrowseAll }: { jobKey: string; onBrowseAll: () => void }) {
  const [show] = useState(() => isShareLanding(jobKey))

  useEffect(() => {
    if (!show) return
    return () => clearShareLanding()
  }, [show])

  if (!show) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
      <Share2 className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="text-muted-foreground">{t("来自分享 · 本站汇集体制内 / 校招 / 编制岗位，每日更新")}</span>
      <button
        type="button"
        className="min-h-11 cursor-pointer rounded font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:min-h-0"
        onClick={() => {
          clearShareLanding()
          onBrowseAll()
        }}
      >
        {t("浏览全部岗位 →")}{' '}</button>
    </div>
  )
}
