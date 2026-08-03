import { useRegisterSW } from 'virtual:pwa-register/react'

/** SW 自动更新注册：新版本 skipWaiting 立即接管，普通刷新即得新版；周期性检查更新。 */
export function ReloadPrompt() {
  useRegisterSW({
    onRegisteredSW(_url, reg) {
      // 每 30 分钟主动检查一次新版本（每日部署场景）
      if (reg) setInterval(() => void reg.update(), 30 * 60 * 1000)
    },
  })
  return null
}
