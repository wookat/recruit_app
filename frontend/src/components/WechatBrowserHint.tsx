import { t } from '@/lib/i18n'
import { Compass, X } from 'lucide-react'
import { dismissWechatHint, isWeChat, useWechatHintDismissed, wechatOpenInBrowserTip } from '@/lib/wechat'

/** 微信内置浏览器顶部轻提示：「在浏览器打开体验更佳」，可关闭且仅提示一次（localStorage 记忆）。 */
export function WechatBrowserHint() {
  const dismissed = useWechatHintDismissed()
  if (!isWeChat() || dismissed) return null

  return (
    <div
      role="status"
      className="sticky top-0 z-[60] flex items-center justify-center gap-1.5 bg-primary/95 px-3 py-1.5 text-xs font-medium text-primary-foreground"
    >
      <Compass className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        {t("在浏览器打开体验更佳（支持截止推送提醒与安装到桌面）：")}
        {wechatOpenInBrowserTip()}
      </span>
      <button
        type="button"
        aria-label={t("关闭")}
        className="-mr-1 inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-primary-foreground/15"
        onClick={dismissWechatHint}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}
