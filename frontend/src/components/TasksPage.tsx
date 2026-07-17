import { useState, useEffect } from 'react'
import { triggerScrape, fetchTaskStatus } from '@/api'
import { Play, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'

const YEARS = [2027, 2026, 2025]

export function TasksPage() {
  const [taskId, setTaskId] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [info, setInfo] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!taskId) return
    const iv = setInterval(async () => {
      try {
        const res = await fetchTaskStatus(taskId)
        setStatus(res.status)
        setInfo(res.info)
        if (res.status === 'SUCCESS' || res.status === 'FAILURE') {
          clearInterval(iv)
        }
      } catch (e) {
        console.error(e)
      }
    }, 2000)
    return () => clearInterval(iv)
  }, [taskId])

  async function start(year: number) {
    setLoading(true)
    try {
      const res = await triggerScrape(year)
      setTaskId(res.task_id)
      setStatus('PENDING')
      setInfo(null)
    } finally {
      setLoading(false)
    }
  }

  const statusClass =
    status === 'SUCCESS'
      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
      : status === 'FAILURE'
        ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
        : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">抓取任务队列</h1>
      <Card>
        <CardHeader>
          <CardTitle>派发 Celery 抓取任务</CardTitle>
          <CardDescription>
            向 Redis 队列提交任务，后台 worker 会自动抓取并去重入库。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {YEARS.map((year) => (
              <Button key={year} onClick={() => start(year)} disabled={loading} className="gap-2">
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                抓取 {year} 岗位
              </Button>
            ))}
          </div>

          {taskId && (
            <div className="rounded-lg border bg-muted/50 p-4 text-sm">
              <div className="mb-2 font-medium">任务 ID</div>
              <div className="break-all font-mono text-muted-foreground">{taskId}</div>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">状态</div>
                  <Badge variant="outline" className={`mt-1 ${statusClass}`}>
                    {status || '-'}
                  </Badge>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">信息</div>
                  <div className="mt-1 break-all text-muted-foreground">
                    {info ? JSON.stringify(info) : '-'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          全国体制内岗位数量极大（国考 2万+/年、省考几十万/年、事业单位及国企上百万），队列会逐步补充。当前已导入
          2025/2026/2027 批量数据，可优先使用。
        </AlertDescription>
      </Alert>
    </div>
  )
}
