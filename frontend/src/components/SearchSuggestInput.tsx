import { t } from '@/lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { getRecentSearches } from '@/lib/storage'
import { pinyinMatch } from '@/lib/pinyin'
import { fetchSuggestions } from '@/api'

export interface SuggestItem {
  text: string
  count?: number
  recent?: boolean
  type?: string
}

export const SUGGEST_TYPE_LABELS: Record<string, string> = {
  hot: '热门',
  employer: '单位',
  category: '类别',
}

/** 远程搜索联想：200ms 防抖 + AbortController，中文输入法组合期不请求，失败静默返回空。 */
export function useSuggest(
  q: string,
  board?: 'positions' | 'campus' | 'bianzhi',
  composing?: boolean,
  enabled = true,
): SuggestItem[] {
  const [items, setItems] = useState<SuggestItem[]>([])
  useEffect(() => {
    const kw = q.trim()
    if (!enabled || composing || !kw) {
      setItems([])
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      fetchSuggestions(kw, { board, signal: ctrl.signal })
        .then((s) =>
          setItems(s.filter((x) => x.text !== kw).map((x) => ({ text: x.text, count: x.count, type: x.type }))),
        )
        .catch(() => setItems([]))
    }, 200)
    return () => {
      ctrl.abort()
      clearTimeout(timer)
    }
  }, [q, board, composing, enabled])
  return items
}

interface Props {
  value: string
  onValueChange: (v: string) => void
  /** 选中联想项或按 Enter 提交时调用。 */
  onSelect: (text: string) => void
  /** 当前板块静态热门词表（枚举）。 */
  words: string[]
  /** 额外动态联想（如 API 联想，已按当前输入过滤）。 */
  extraItems?: SuggestItem[]
  /** 启用 /api/suggest 远程联想；'all' 为三板块混合。 */
  suggestBoard?: 'positions' | 'campus' | 'bianzhi' | 'all'
  placeholder?: string
  inputClassName?: string
}

/** 搜索输入 + 纯前端下拉联想：最近搜索 + 板块词表，键盘可选，Esc/点击外部关闭。
 *  输入值由组件内部持有，防抖 250ms 后才回调 onValueChange，
 *  避免每敲一个字符重渲染父页面整表。 */
export function SearchSuggestInput({
  value,
  onValueChange,
  onSelect,
  words,
  extraItems,
  suggestBoard,
  placeholder,
  inputClassName,
}: Props) {
  const [text, setText] = useState(value)
  const [debounced, setDebounced] = useState(value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [composing, setComposing] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const commitRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCommitted = useRef(value)

  const remoteItems = useSuggest(
    text,
    suggestBoard === 'all' ? undefined : suggestBoard,
    composing,
    !!suggestBoard && open,
  )

  // 外部变更（清除筛选/一键匹配等）同步到内部；
  // 输入框聚焦中不覆写正在输入的内容，避免防抖提交与父级回传的竞态吞掉按键
  useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value
      if (document.activeElement !== inputRef.current) setText(value)
    }
  }, [value])

  const handleChange = (v: string) => {
    setText(v)
    setOpen(true)
    if (commitRef.current) clearTimeout(commitRef.current)
    commitRef.current = setTimeout(() => {
      lastCommitted.current = v
      onValueChange(v)
    }, 250)
  }

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 150)
    return () => clearTimeout(t)
  }, [text])

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [])

  const items = useMemo<SuggestItem[]>(() => {
    const q = debounced.trim().toLowerCase()
    if (!q) return []
    const seen = new Set<string>([debounced.trim()])
    const out: SuggestItem[] = []
    const push = (it: SuggestItem) => {
      if (out.length >= 8 || seen.has(it.text)) return
      seen.add(it.text)
      out.push(it)
    }
    for (const r of getRecentSearches()) {
      if (pinyinMatch(r, q)) push({ text: r, recent: true })
    }
    for (const it of remoteItems) push(it)
    for (const it of extraItems || []) push(it)
    for (const w of words) {
      if (pinyinMatch(w, q)) push({ text: w })
    }
    return out
  }, [debounced, words, extraItems, remoteItems])

  useEffect(() => {
    setActive(-1)
  }, [items])

  const showList = open && debounced.trim().length >= 1 && items.length > 0

  const select = (t: string) => {
    if (commitRef.current) clearTimeout(commitRef.current)
    lastCommitted.current = t
    setText(t)
    setOpen(false)
    onSelect(t)
  }

  return (
    <div ref={rootRef} className="relative flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // 失焦时立即提交待防抖内容，避免丢失末尾输入
          if (commitRef.current) {
            clearTimeout(commitRef.current)
            commitRef.current = null
          }
          if (text !== lastCommitted.current) {
            lastCommitted.current = text
            onValueChange(text)
          }
        }}
        placeholder={placeholder}
        className={cn('pl-9', inputClassName)}
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            return
          }
          if (!showList) {
            if (e.key === 'Enter') {
              e.preventDefault()
              select(text.trim())
            }
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => (a + 1) % items.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            select(active >= 0 ? items[active].text : text.trim())
          }
        }}
      />
      {showList && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-w-full overflow-hidden rounded-lg bg-popover shadow-md ring-1 ring-foreground/10">
          {items.map((it, i) => (
            <button
              key={it.text}
              type="button"
              className={cn(
                'flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted sm:min-h-0',
                i === active && 'bg-muted',
              )}
              onMouseEnter={() => setActive(i)}
              onClick={() => select(it.text)}
            >
              {it.recent ? (
                <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="flex-1 truncate">{it.text}</span>
              {it.type && SUGGEST_TYPE_LABELS[it.type] && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-inset ring-foreground/10">
                  {t(SUGGEST_TYPE_LABELS[it.type])}
                </span>
              )}
              {it.recent && <span className="text-[11px] text-muted-foreground">{t("最近")}</span>}
              {it.count !== undefined && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {it.count.toLocaleString()} {' '}{t("条")}{' '}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
