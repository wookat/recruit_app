import { useState } from 'react'
import { Check, ClipboardCopy, Link2, Share2, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

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
  const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator

  const flash = (kind: 'link' | 'text') => {
    setCopied(kind)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
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

/** 「【公司/单位】岗位 | 地点 | 截止:X | 链接」格式，空字段跳过。 */
export function buildShareText(parts: {
  org?: string | null
  title?: string | null
  location?: string | null
  deadline?: string | null
  url?: string | null
}): string {
  const segs: string[] = []
  const head = `${parts.org ? `【${parts.org}】` : ''}${parts.title ?? ''}`.trim()
  if (head) segs.push(head)
  if (parts.location) segs.push(parts.location)
  if (parts.deadline) segs.push(`截止:${parts.deadline}`)
  if (parts.url) segs.push(parts.url)
  return segs.join(' | ')
}
