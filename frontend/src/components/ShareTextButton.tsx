import { useState } from 'react'
import { Check, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

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
