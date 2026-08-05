import { t } from '@/lib/i18n'
import { X } from 'lucide-react'

/** 同义扩展提示：「已同时匹配：××」，可关闭（关闭后仅按原词搜索）。 */
export function SynonymHint({ added, onClose }: { added: string[]; onClose: () => void }) {
  if (!added.length) return null
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">{t("已同时匹配：")}{added.join('、')}</span>
      <button
        type="button"
        aria-label={t("关闭同义词扩展")}
        title={t("关闭同义词扩展，仅按原词搜索")}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground sm:h-6 sm:w-6"
        onClick={onClose}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
