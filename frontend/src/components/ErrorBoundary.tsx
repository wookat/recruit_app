import { t } from '@/lib/i18n'
import { forcePurgeReload, purgeReloadOnce } from '@/lib/lazyRetry'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/** 全站错误边界：渲染崩溃时显示可刷新的兜底页，避免白屏。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
    purgeReloadOnce() // 旧缓存 chunk 与新代码不匹配时清缓存自愈一次；已刷过则留在兜底页
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <div className="space-y-1">
          <p className="text-lg font-semibold text-foreground">{t("出错了")}</p>
          <p className="text-sm text-muted-foreground">{t("页面遇到意外错误，刷新后即可恢复")}</p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={() => forcePurgeReload()}
        >
          <RefreshCw className="h-4 w-4" />
          {t("点击刷新")}{' '}</button>
      </div>
    )
  }
}
