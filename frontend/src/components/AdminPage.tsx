import { useCallback, useEffect, useState } from 'react'
import {
  adminCheckSource,
  adminListAnnouncements,
  adminListSources,
  adminOverview,
  adminSeedSources,
  adminSetAnnouncementStatus,
  adminUpdateSource,
  type AdminOverview,
  type Announcement,
  type WatchSource,
} from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RefreshCw, ShieldCheck } from 'lucide-react'

const TOKEN_KEY = 'recruit.adminToken'

export function AdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [input, setInput] = useState('')
  const [authed, setAuthed] = useState(false)
  const [error, setError] = useState('')
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [sources, setSources] = useState<WatchSource[]>([])
  const [anns, setAnns] = useState<Announcement[]>([])
  const [annFilter, setAnnFilter] = useState<string>('new')
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(
    async (tk: string) => {
      try {
        const [ov, srcs, list] = await Promise.all([
          adminOverview(tk),
          adminListSources(tk),
          adminListAnnouncements(tk, annFilter === 'all' ? undefined : annFilter),
        ])
        setOverview(ov)
        setSources(srcs)
        setAnns(list)
        setAuthed(true)
        setError('')
        localStorage.setItem(TOKEN_KEY, tk)
      } catch {
        setAuthed(false)
        setError('令牌无效或后台未配置')
      }
    },
    [annFilter],
  )

  useEffect(() => {
    if (token) void load(token)
  }, [token, load])

  if (!authed) {
    return (
      <div className="mx-auto max-w-sm space-y-4 py-16">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="h-5 w-5" /> 管理后台登录
        </div>
        <Input
          type="password"
          placeholder="输入管理令牌"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setToken(input)}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button className="w-full" onClick={() => setToken(input)} disabled={!input}>
          登录
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">管理后台</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => load(token)}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> 刷新
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await adminSeedSources(token)
              void load(token)
            }}
          >
            导入默认来源
          </Button>
        </div>
      </div>

      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="岗位总量" value={overview.positions.total} />
          <StatCard label="清洗后岗位" value={overview.positions.clean} />
          <StatCard
            label="监控来源"
            value={overview.watch_sources.enabled}
            sub={`共 ${overview.watch_sources.total} · 异常 ${overview.watch_sources.error}`}
          />
          <StatCard
            label="待处理公告"
            value={overview.announcements.new}
            sub={`累计 ${overview.announcements.total}`}
          />
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">采集来源</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">名称</th>
                <th className="py-2 pr-3">分类</th>
                <th className="py-2 pr-3">间隔</th>
                <th className="py-2 pr-3">最近检查</th>
                <th className="py-2 pr-3">状态</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="max-w-[220px] py-2 pr-3">
                    <div className="truncate font-medium">{s.name}</div>
                    <a
                      href={s.index_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block max-w-[220px] truncate text-xs text-muted-foreground hover:underline"
                    >
                      {s.index_url}
                    </a>
                  </td>
                  <td className="py-2 pr-3">{s.category || '-'}</td>
                  <td className="py-2 pr-3">{s.interval_minutes} 分</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-xs">
                    {s.last_checked_at ? new Date(s.last_checked_at).toLocaleString('zh-CN') : '未检查'}
                  </td>
                  <td className="py-2 pr-3">
                    {s.last_status === 'error' ? (
                      <Badge variant="destructive" title={s.last_message || ''}>
                        异常
                      </Badge>
                    ) : s.last_status === 'ok' ? (
                      <Badge variant="secondary" title={s.last_message || ''}>
                        正常
                      </Badge>
                    ) : (
                      <Badge variant="outline">待检查</Badge>
                    )}
                    {!s.enabled && <Badge variant="outline" className="ml-1">停用</Badge>}
                  </td>
                  <td className="whitespace-nowrap py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      disabled={busy === s.id}
                      onClick={async () => {
                        setBusy(s.id)
                        try {
                          await adminCheckSource(token, s.id)
                          await load(token)
                        } finally {
                          setBusy(null)
                        }
                      }}
                    >
                      {busy === s.id ? '检查中...' : '立即检查'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={async () => {
                        await adminUpdateSource(token, s.id, {
                          name: s.name,
                          index_url: s.index_url,
                          keywords: s.keywords,
                          category: s.category,
                          year: s.year,
                          enabled: s.enabled ? 0 : 1,
                          interval_minutes: s.interval_minutes,
                        })
                        void load(token)
                      }}
                    >
                      {s.enabled ? '停用' : '启用'}
                    </Button>
                  </td>
                </tr>
              ))}
              {sources.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    暂无来源，点击「导入默认来源」初始化
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">公告审核</CardTitle>
          <div className="flex gap-1">
            {['new', 'processed', 'ignored', 'all'].map((f) => (
              <Button
                key={f}
                size="sm"
                variant={annFilter === f ? 'default' : 'outline'}
                className="h-7 px-2 text-xs"
                onClick={() => setAnnFilter(f)}
              >
                {{ new: '待处理', processed: '已处理', ignored: '已忽略', all: '全部' }[f]}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {anns.map((a) => (
            <div
              key={a.id}
              className="flex flex-col gap-1 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {a.title}
                </a>
                <div className="text-xs text-muted-foreground">
                  {a.detected_at ? new Date(a.detected_at).toLocaleString('zh-CN') : ''}
                </div>
              </div>
              {a.status === 'new' && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={async () => {
                      await adminSetAnnouncementStatus(token, a.id, 'processed')
                      void load(token)
                    }}
                  >
                    标记已处理
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={async () => {
                      await adminSetAnnouncementStatus(token, a.id, 'ignored')
                      void load(token)
                    }}
                  >
                    忽略
                  </Button>
                </div>
              )}
            </div>
          ))}
          {anns.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">暂无公告</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold tabular-nums">{value.toLocaleString()}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}
