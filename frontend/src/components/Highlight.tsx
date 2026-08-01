import type { ReactNode } from 'react'

/** 关键词高亮：React 节点拆分（无 dangerouslySetInnerHTML），大小写不敏感，O(n)。 */
export function Highlight({
  text,
  query,
}: {
  text: string | null | undefined
  query?: string | null
}) {
  const t = text || ''
  const q = (query || '').trim()
  if (!t || !q) return <>{t}</>
  const lower = t.toLowerCase()
  const lq = q.toLowerCase()
  const parts: ReactNode[] = []
  let i = 0
  for (;;) {
    const idx = lower.indexOf(lq, i)
    if (idx === -1) {
      if (i < t.length) parts.push(t.slice(i))
      break
    }
    if (idx > i) parts.push(t.slice(i, idx))
    parts.push(
      <mark
        key={idx}
        className="rounded-xs bg-primary/15 px-0.5 text-primary dark:bg-primary/25 dark:text-primary"
      >
        {t.slice(idx, idx + q.length)}
      </mark>,
    )
    i = idx + q.length
  }
  return <>{parts}</>
}
