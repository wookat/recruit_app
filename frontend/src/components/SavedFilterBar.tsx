import { useState } from 'react'
import { Bookmark, BookmarkPlus, Check, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  deleteQuery,
  getSavedQueries,
  saveQuery,
  type SavedQuery,
} from '@/lib/storage'

interface Props {
  /** 板块作用域（campus / bianzhi）。 */
  board: string
  /** 当前生效筛选的 URL 参数快照（仅含已生效项）。 */
  snapshot: Record<string, string>
  /** 自动生成的默认名称。 */
  defaultName: string
  /** 是否有任一筛选/关键词生效。 */
  canSave: boolean
}

/** 常用筛选：保存当前 URL 参数快照为可点 chips，点击整体应用（复用 URL 恢复逻辑）。 */
export function SavedFilterBar({ board, snapshot, defaultName, canSave }: Props) {
  const [saved, setSaved] = useState<SavedQuery[]>(() => getSavedQueries(board))
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [hint, setHint] = useState<string | null>(null)

  if (saved.length === 0 && !canSave) return null

  const apply = (f: SavedQuery) => {
    const q = new URLSearchParams(f.query)
    q.set('board', board)
    window.location.href = `${window.location.pathname}?${q.toString()}`
  }

  const handleSave = () => {
    const name = saveName.trim() || defaultName
    if (!name) return
    const query = new URLSearchParams(snapshot).toString()
    const { list, dropped } = saveQuery(board, name, query)
    setSaved(list)
    setSaveOpen(false)
    setSaveName('')
    setHint(dropped ? `已达 10 组上限，删除了最旧的「${dropped}」` : null)
    if (dropped) setTimeout(() => setHint(null), 4000)
  }

  return (
    <div className="flex max-w-full flex-wrap items-center gap-2 text-xs">
      <Bookmark className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-muted-foreground">常用筛选：</span>
      {saved.map((f) => (
        <Badge key={f.name} variant="secondary" className="max-w-full gap-1 font-normal">
          <span className="cursor-pointer truncate" onClick={() => apply(f)}>
            {f.name}
          </span>
          <button
            type="button"
            aria-label={`删除筛选 ${f.name}`}
            className="cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={() => setSaved(deleteQuery(board, f.name))}
          >
            <X className="pointer-events-none h-3 w-3" />
          </button>
        </Badge>
      ))}
      {saveOpen ? (
        <span className="inline-flex max-w-full items-center gap-1">
          <Input
            autoFocus
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              else if (e.key === 'Escape') setSaveOpen(false)
            }}
            placeholder={defaultName || '筛选名称'}
            className="h-9 w-40 max-w-full text-xs sm:h-7 sm:w-32"
          />
          <Button size="icon" variant="ghost" className="h-9 w-9 sm:h-7 sm:w-7" onClick={handleSave} aria-label="确认保存">
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 sm:h-7 sm:w-7"
            onClick={() => {
              setSaveOpen(false)
              setSaveName('')
            }}
            aria-label="取消保存"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </span>
      ) : (
        <Button
          variant="link"
          size="sm"
          className="h-auto min-h-11 p-0 text-xs sm:min-h-0"
          disabled={!canSave}
          onClick={() => {
            setSaveName(defaultName)
            setSaveOpen(true)
          }}
        >
          <BookmarkPlus className="mr-0.5 h-3.5 w-3.5" />
          保存当前筛选
        </Button>
      )}
      {hint && <span className="text-muted-foreground">{hint}</span>}
    </div>
  )
}
