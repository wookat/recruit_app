import { useEffect, useState } from 'react'
import { fetchFreshness } from '@/api'

function formatFreshness(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso)
  if (isNaN(t.getTime())) return null
  const hours = (Date.now() - t.getTime()) / 3600000
  if (hours < 1) return '刚刚更新'
  if (hours <= 48) return `数据更新于 ${Math.floor(hours)} 小时前`
  return `数据更新于 ${iso.slice(0, 10)}`
}

export function FreshnessNote({
  board,
  showTotal,
}: {
  board: 'positions' | 'campus' | 'bianzhi'
  showTotal?: boolean
}) {
  const [text, setText] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchFreshness()
      .then((f) => {
        if (cancelled) return
        setText(formatFreshness(f[board].last_success))
        setTotal(typeof f[board].total === 'number' ? f[board].total : null)
        setLoaded(true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [board])

  if (showTotal) {
    // 数据说明用：条数 + 同步时间，取不到的数字显示「—」不伪造
    if (!loaded) return <span className="text-xs text-muted-foreground">—</span>
    return (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {total != null ? `${total.toLocaleString()} 条` : '—'} · {text ?? '同步时间 —'}
      </span>
    )
  }
  if (!text) return null
  return <span className="whitespace-nowrap text-xs text-muted-foreground">{text}</span>
}
