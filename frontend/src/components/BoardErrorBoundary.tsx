import { t } from '@/lib/i18n'
import { purgeReloadOnce } from '@/lib/lazyRetry'
import { Component, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  /** 变化时自动重置错误态（如板块切换） */
  resetKey: string
  children: ReactNode
}

interface State {
  hasError: boolean
  lastKey: string
}

/** 板块级错误边界：渲染异常时显示可重试的提示卡，而不是整块空白。 */
export class BoardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, lastKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true }
  }

  componentDidCatch() {
    purgeReloadOnce() // 旧缓存 chunk 与新代码不匹配时清缓存自愈一次；已刷过则留在错误卡
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.lastKey) {
      return { hasError: false, lastKey: props.resetKey }
    }
    return null
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">{t("板块加载出错了，请重试")}</p>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => this.setState({ hasError: false })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("重试")}{' '}</Button>
        </div>
      )
    }
    return this.props.children
  }
}
