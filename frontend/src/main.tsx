import React from 'react'
import ReactDOM from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { OfflineBanner } from '@/components/OfflineBanner'
import { ReloadPrompt } from '@/components/ReloadPrompt'
import { WechatBrowserHint } from '@/components/WechatBrowserHint'
import App from './App'
import './index.css'

declare global {
  interface Window {
    /** index.html 引导守护脚本注入：入口 bundle 执行成功时调用以清除白屏哨兵 */
    __bootOk?: () => void
    __appMounted?: boolean
  }
}

// 通知 index.html 引导守护脚本：入口 bundle 已执行、React 即将挂载，清除白屏哨兵
window.__bootOk?.()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <OfflineBanner />
      <WechatBrowserHint />
      <ReloadPrompt />
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
