import { useEffect, useState } from 'react'
import { Check, ClipboardCopy, Link2, QrCode, Share2, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

/** 二维码分享弹层：懒加载 qrcode 生成深链二维码，长按可保存。 */
function QrShareDialog({
  url,
  title,
  open,
  onClose,
}: {
  url: string
  title?: string
  open: boolean
  onClose: () => void
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setDataUrl(null)
    setError(false)
    import('qrcode')
      .then((m) => m.toDataURL(url, { width: 480, margin: 2 }))
      .then((d) => {
        if (!cancelled) setDataUrl(d)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, url])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <QrCode className="h-4 w-4 text-primary" />
            扫码打开岗位详情
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-2">
          {error ? (
            <p className="py-8 text-sm text-muted-foreground">二维码生成失败，请重试</p>
          ) : dataUrl ? (
            <img
              src={dataUrl}
              alt={`岗位深链二维码：${title || url}`}
              className="h-56 w-56 rounded-lg border border-border bg-white p-1"
            />
          ) : (
            <div className="h-56 w-56 animate-pulse rounded-lg bg-muted" />
          )}
          {title && <p className="line-clamp-2 text-center text-xs text-muted-foreground">{title}</p>}
          <p className="text-xs text-muted-foreground">手机扫码直达；长按图片可保存分享</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 分享菜单按钮：复制链接 / 复制分享文本 / 系统分享（navigator.share 支持时）。 */
export function ShareMenuButton({
  text,
  url,
  title,
  className,
}: {
  text: string
  url: string
  title?: string
  className?: string
}) {
  const [copied, setCopied] = useState<'link' | 'text' | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator

  const flash = (kind: 'link' | 'text') => {
    setCopied(kind)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            title="分享"
            aria-label="分享"
            className={cn(
              'relative h-11 w-11 text-muted-foreground hover:text-primary sm:h-8 sm:w-8',
              className,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {copied ? <Check className="h-4 w-4 text-green-600 dark:text-green-400" /> : <Share2 className="h-4 w-4" />}
            {copied && (
              <span className="absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 text-[11px] text-background shadow">
                {copied === 'link' ? '链接已复制' : '已复制'}
              </span>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem
          className="min-h-11 gap-2 sm:min-h-8"
          onClick={async () => {
            await copyText(url)
            flash('link')
          }}
        >
          <Link2 className="h-4 w-4" />
          复制链接
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11 gap-2 sm:min-h-8"
          onClick={async () => {
            await copyText(text)
            flash('text')
          }}
        >
          <ClipboardCopy className="h-4 w-4" />
          复制分享文本
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 gap-2 sm:min-h-8" onClick={() => setQrOpen(true)}>
          <QrCode className="h-4 w-4" />
          二维码分享
        </DropdownMenuItem>
        {canNativeShare && (
          <DropdownMenuItem
            className="min-h-11 gap-2 sm:min-h-8"
            onClick={() => {
              navigator.share({ title: title || document.title, text, url }).catch(() => undefined)
            }}
          >
            <Smartphone className="h-4 w-4" />
            系统分享
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    <QrShareDialog url={url} title={title} open={qrOpen} onClose={() => setQrOpen(false)} />
    </>
  )
}

/** 复制分享文本按钮：成功后短暂显示对勾与「已复制」提示。 */
export function ShareTextButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon"
      title="复制分享文本"
      aria-label="复制分享文本"
      className={cn('relative h-11 w-11 text-muted-foreground hover:text-primary sm:h-8 sm:w-8', className)}
      onClick={async (e) => {
        e.stopPropagation()
        await copyText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="h-4 w-4 text-green-600 dark:text-green-400" /> : <Share2 className="h-4 w-4" />}
      {copied && (
        <span className="absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 text-[11px] text-background shadow">
          已复制
        </span>
      )}
    </Button>
  )
}

/** 「【公司/单位】岗位 | 地点 | 截止:X | 本站深链 | 官方公告:链接」格式，空字段跳过。 */
export function buildShareText(parts: {
  org?: string | null
  title?: string | null
  location?: string | null
  deadline?: string | null
  /** 本站详情深链，置于链接首位（分享卡片由后端 og 注入）。 */
  deepLink?: string | null
  url?: string | null
}): string {
  const segs: string[] = []
  const head = `${parts.org ? `【${parts.org}】` : ''}${parts.title ?? ''}`.trim()
  if (head) segs.push(head)
  if (parts.location) segs.push(parts.location)
  if (parts.deadline) segs.push(`截止:${parts.deadline}`)
  if (parts.deepLink) {
    segs.push(parts.deepLink)
    if (parts.url) segs.push(`官方公告:${parts.url}`)
  } else if (parts.url) {
    segs.push(parts.url)
  }
  return segs.join(' | ')
}
