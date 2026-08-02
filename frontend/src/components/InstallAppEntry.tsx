import { useState, useSyncExternalStore } from 'react'
import { MonitorDown, Share, SquarePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// beforeinstallprompt 在页面加载早期触发，模块级捕获避免组件挂载太晚错过
let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    listeners.forEach((l) => l())
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    listeners.forEach((l) => l())
  })
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true)
  )
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

const IOS_STEPS = [
  { icon: Share, text: '用 Safari 打开本站，点击底部工具栏的「分享」按钮' },
  { icon: SquarePlus, text: '在分享菜单中向下找到「添加到主屏幕」并点击' },
  { icon: MonitorDown, text: '点击右上角「添加」，桌面即出现上岸罗盘图标，像 App 一样打开' },
]

/** 「安装到桌面」入口：安卓 beforeinstallprompt 直接调起，iOS 显示分步引导弹层。 */
export function InstallAppEntry() {
  const canPrompt = useSyncExternalStore(subscribe, () => deferredPrompt !== null)
  const [iosOpen, setIosOpen] = useState(false)

  if (isStandalone()) return null

  const handleClick = () => {
    if (deferredPrompt) {
      void deferredPrompt.prompt()
      void deferredPrompt.userChoice.then(() => {
        deferredPrompt = null
        listeners.forEach((l) => l())
      })
    } else {
      setIosOpen(true)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
        <MonitorDown className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-sm">把上岸罗盘安装到桌面，像 App 一样一键打开，支持离线查看收藏</span>
        <Button size="sm" className="min-h-11 sm:min-h-8" onClick={handleClick}>
          安装到桌面
        </Button>
      </div>
      <Dialog open={iosOpen} onOpenChange={setIosOpen}>
        <DialogContent className="max-w-xs sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <MonitorDown className="h-4 w-4 text-primary" />
              安装到主屏幕
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {isIos() && !canPrompt
              ? 'iPhone / iPad 上按以下步骤添加：'
              : '当前浏览器未提供一键安装，可按以下步骤手动添加（iOS Safari 示例）：'}
          </p>
          <ol className="space-y-3">
            {IOS_STEPS.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="flex min-w-0 items-start gap-1.5 leading-relaxed">
                  <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  {s.text}
                </span>
              </li>
            ))}
          </ol>
          <Button variant="outline" className="min-h-11 w-full sm:min-h-9" onClick={() => setIosOpen(false)}>
            <X className="h-4 w-4" />
            知道了
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
