import { useState } from 'react'
import { BadgeCheck, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { domainOf, sourceTrust, useConfirmExtLink } from '@/lib/extLink'

/** 详情外链：显示目标域名徽章；开启「外链打开前确认」时先弹确认层再跳转。 */
export function ExtLinkAnchor({ url }: { url: string }) {
  const confirmOn = useConfirmExtLink()
  const [pending, setPending] = useState(false)
  const domain = domainOf(url)
  const trust = sourceTrust(url)

  const openNow = () => {
    setPending(false)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex items-center break-all text-sm text-primary hover:underline"
        onClick={(e) => {
          if (confirmOn) {
            e.preventDefault()
            setPending(true)
          }
        }}
      >
        {url}
        <ExternalLink className="ml-1 h-3 w-3 shrink-0" />
      </a>
      {domain && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>跳转至：{domain}</span>
          {trust === 'official' && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-px font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              <BadgeCheck className="h-3 w-3" aria-hidden="true" />
              官方来源
            </span>
          )}
          {trust === 'third-party' && (
            <span className="rounded-full bg-muted px-1.5 py-px">第三方来源 · 请以官方公告为准</span>
          )}
        </div>
      )}
      {confirmOn && (
        <Dialog open={pending} onOpenChange={(o) => !o && setPending(false)}>
          <DialogContent className="max-w-xs shadow-lg sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>即将打开外部链接</DialogTitle>
              <DialogDescription>
                目标网站：<span className="font-medium text-foreground">{domain || url}</span>
                {domain && <span className="mt-1 block truncate text-xs opacity-70">{url}</span>}
                <span className="mt-1 block">外部网站内容与本站无关，请注意甄别信息与保护个人信息安全。</span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={() => setPending(false)}>
                取消
              </Button>
              <Button size="sm" className="min-h-11 sm:min-h-9" onClick={openNow}>
                继续打开
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
