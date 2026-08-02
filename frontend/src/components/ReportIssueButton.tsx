import { useState } from 'react'
import { Flag } from 'lucide-react'
import { submitFeedback, type FeedbackIssueType } from '@/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

const ISSUE_TYPES: { key: FeedbackIssueType; label: string }[] = [
  { key: 'link_broken', label: '链接失效' },
  { key: 'wrong_info', label: '信息错误' },
  { key: 'expired', label: '已过期' },
  { key: 'other', label: '其他' },
]

/** 岗位详情「举报数据有误」入口：问题类型 + 可选备注，提交到 /api/feedback。 */
export function ReportIssueButton({
  board,
  itemId,
  className,
}: {
  board: 'positions' | 'campus' | 'bianzhi'
  itemId: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [issueType, setIssueType] = useState<FeedbackIssueType | null>(null)
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  const reset = () => {
    setIssueType(null)
    setNote('')
    setState('idle')
  }

  const submit = async () => {
    if (!issueType || state === 'sending') return
    setState('sending')
    try {
      await submitFeedback(board, itemId, issueType, note.trim() || undefined)
      setState('done')
    } catch {
      setState('error')
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="举报数据有误"
        title="举报数据有误"
        className={cn('h-11 w-11 sm:h-8 sm:w-8', className)}
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        <Flag className="h-4 w-4 text-muted-foreground" />
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-sm gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle>举报数据有误</DialogTitle>
          </DialogHeader>
          {state === 'done' ? (
            <div className="space-y-3 p-4">
              <p className="text-sm">已提交，感谢反馈！我们会尽快核实处理。</p>
              <Button className="min-h-11 w-full sm:min-h-9" onClick={() => setOpen(false)}>
                关闭
              </Button>
            </div>
          ) : (
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap gap-1.5">
                {ISSUE_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={issueType === t.key}
                    className={cn(
                      'min-h-11 cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors sm:min-h-9',
                      issueType === t.key
                        ? 'border-primary/40 bg-primary/5 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted',
                    )}
                    onClick={() => setIssueType(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                placeholder="补充说明（选填，如：报名链接打不开）"
                rows={3}
                className="text-sm"
              />
              {state === 'error' && (
                <p className="text-xs text-destructive">提交失败，请稍后再试</p>
              )}
              <Button
                className="min-h-11 w-full sm:min-h-9"
                disabled={!issueType || state === 'sending'}
                onClick={submit}
              >
                {state === 'sending' ? '提交中…' : '提交反馈'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
