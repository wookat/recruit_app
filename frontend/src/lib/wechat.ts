import { useSyncExternalStore } from 'react'
import { t } from './i18n'

const HINT_DISMISS_KEY = 'recruit.wechatHintDismissed'
const HINT_EVENT = 'recruit-wechat-hint-change'

/** 是否在微信内置浏览器中（MicroMessenger UA，iOS WKWebView / Android X5 均含）。 */
export function isWeChat(): boolean {
  return typeof navigator !== 'undefined' && /micromessenger/i.test(navigator.userAgent)
}

/** iOS 微信（WKWebView，无 Web Push / beforeinstallprompt）。 */
export function isWeChatIos(): boolean {
  return isWeChat() && /iphone|ipad|ipod/i.test(navigator.userAgent)
}

/** Android 微信（X5/XWeb 内核，可能暴露 serviceWorker 但推送/安装均不可用）。 */
export function isWeChatAndroid(): boolean {
  return isWeChat() && /android/i.test(navigator.userAgent)
}

/** 微信内「用浏览器打开」的操作指引文案（iOS/Android 菜单措辞一致，均为右上角「…」）。 */
export function wechatOpenInBrowserTip(): string {
  return isWeChatIos()
    ? t('点右上角「…」→「在浏览器中打开」（Safari）')
    : t('点右上角「…」→「在浏览器打开」')
}

export function getWechatHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_DISMISS_KEY) === '1'
  } catch {
    return true
  }
}

export function dismissWechatHint(): void {
  try {
    localStorage.setItem(HINT_DISMISS_KEY, '1')
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(HINT_EVENT))
}

function subscribe(cb: () => void) {
  window.addEventListener(HINT_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(HINT_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

export function useWechatHintDismissed(): boolean {
  return useSyncExternalStore(subscribe, getWechatHintDismissed)
}
