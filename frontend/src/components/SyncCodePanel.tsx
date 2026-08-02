import { useState } from 'react'
import { Check, ClipboardCopy, Download, MonitorSmartphone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { downloadBackup } from '@/lib/backup'
import { copyText } from '@/lib/clipboard'
import { generateSyncCode, importSyncCode, SYNC_CODE_MAX } from '@/lib/syncCode'

/** 多设备同步码面板：生成/复制同步码，或粘贴另一设备的同步码导入合并。 */
export function SyncCodePanel({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('')
  const [pasted, setPasted] = useState('')
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [tooLarge, setTooLarge] = useState(false)

  const generate = async () => {
    setMsg(null)
    try {
      const c = await generateSyncCode()
      if (c.length > SYNC_CODE_MAX) {
        setTooLarge(true)
        setCode('')
        return
      }
      setTooLarge(false)
      setCode(c)
      await copyText(c)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '生成失败' })
    }
  }

  const doImport = async () => {
    setMsg(null)
    try {
      const r = await importSyncCode(pasted)
      const extras = [
        r.profileApplied ? '画像已同步' : null,
        r.prefsApplied > 0 ? `偏好 ${r.prefsApplied} 项` : null,
      ].filter(Boolean)
      setMsg({
        ok: true,
        text: `已合并：体制内 ${r.positions} · 校招 ${r.campus} · 编制 ${r.bianzhi}，新增 ${r.added} 条 · 更新 ${r.updated} 条${extras.length ? `（${extras.join('，')}）` : ''}`,
      })
      setPasted('')
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '导入失败' })
    }
  }

  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="flex items-center gap-1.5">
        <MonitorSmartphone className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">多设备同步码</span>
        <span className="text-xs text-muted-foreground">仅本机数据 · 无需账号</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭多设备同步码"
          className="ml-auto h-11 w-11 text-muted-foreground sm:h-6 sm:w-6"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        把收藏、投递进度、画像与偏好打包成一段文本码，在另一台设备粘贴导入即可合并（不覆盖已有数据）。
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-2 h-auto min-h-11 w-full gap-1.5 text-xs sm:min-h-8"
        onClick={generate}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
        {copied ? '同步码已复制，去另一设备粘贴' : '生成并复制同步码'}
      </Button>
      {tooLarge && (
        <div className="mt-2 space-y-1.5 text-xs text-amber-700 dark:text-amber-300">
          数据较多，同步码过长易被聊天工具截断——建议改用备份文件传输：
          <Button
            variant="outline"
            size="sm"
            className="h-auto min-h-11 w-full gap-1.5 text-xs sm:min-h-8"
            onClick={downloadBackup}
          >
            <Download className="h-3.5 w-3.5" />
            下载备份 JSON（另一设备用「恢复备份」导入）
          </Button>
        </div>
      )}
      {code && !tooLarge && (
        <textarea
          readOnly
          value={code}
          rows={2}
          className="mt-2 w-full resize-none rounded-md border bg-background p-2 font-mono text-[11px] text-muted-foreground"
          onFocus={(e) => e.target.select()}
        />
      )}
      <div className="mt-2 space-y-1.5">
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={2}
          placeholder="粘贴另一设备生成的同步码（SC1: 开头）"
          className="w-full resize-none rounded-md border bg-background p-2 font-mono text-[11px]"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-auto min-h-11 w-full text-xs sm:min-h-8"
          disabled={!pasted.trim()}
          onClick={doImport}
        >
          导入并合并
        </Button>
      </div>
      {msg && (
        <p className={`mt-1.5 text-xs ${msg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {msg.text}
        </p>
      )}
    </div>
  )
}
