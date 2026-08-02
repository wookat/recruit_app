import { useEffect, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { exportDownloadUrl, fetchExportStatus } from '@/api'

const SYNC_EXPORT_MAX = 2000
const ASYNC_EXPORT_MAX = 50000

interface Props {
  /** 当前筛选结果总数（0 时禁用） */
  total: number
  /** ≤2000 行同步导出：返回同步导出 URL */
  buildSyncUrl: () => string
  /** >2000 行异步导出：创建任务返回 task_id */
  startAsync: (maxRows: number) => Promise<{ task_id: string }>
  className?: string
}

/** 列表「导出当前结果 CSV」：≤2000 行走同步下载，更多走异步任务轮询后自动下载。 */
export function BoardExportButton({ total, buildSyncUrl, startAsync, className }: Props) {
  const [task, setTask] = useState<string | null>(null)
  const [error, setError] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const errTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (errTimerRef.current) clearTimeout(errTimerRef.current)
    },
    [],
  )

  const showError = (msg: string) => {
    setError(msg)
    if (errTimerRef.current) clearTimeout(errTimerRef.current)
    errTimerRef.current = setTimeout(() => setError(''), 5000)
  }

  const stopPolling = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }

  const poll = (taskId: string) => {
    stopPolling()
    timerRef.current = setInterval(async () => {
      try {
        const st = await fetchExportStatus(taskId)
        if (st.status === 'SUCCESS') {
          stopPolling()
          setTask(null)
          window.location.assign(exportDownloadUrl(taskId))
        } else if (st.status === 'FAILURE' || st.status === 'REVOKED') {
          stopPolling()
          setTask(null)
          showError(`导出失败：${st.error || '服务端处理出错，请重试'}`)
        }
      } catch {
        stopPolling()
        setTask(null)
        showError('导出状态查询失败，请重试')
      }
    }, 3000)
  }

  const handleExport = async () => {
    if (task || total <= 0) return
    setError('')
    if (total <= SYNC_EXPORT_MAX) {
      window.open(buildSyncUrl(), '_blank')
      return
    }
    setTask('starting')
    try {
      const { task_id } = await startAsync(Math.min(total, ASYNC_EXPORT_MAX))
      setTask(task_id)
      poll(task_id)
    } catch {
      setTask(null)
      showError('导出任务创建失败，请稍后重试（频率限制：每分钟 3 次）')
    }
  }

  return (
    <span className={className}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 gap-1.5 sm:min-h-8"
        disabled={total <= 0 || !!task}
        title={total > SYNC_EXPORT_MAX ? `结果超过 ${SYNC_EXPORT_MAX.toLocaleString()} 条，走后台任务导出` : '导出当前筛选结果'}
        onClick={handleExport}
      >
        {task ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        {task ? '导出中…' : '导出 CSV'}
      </Button>
      {error && (
        <span role="alert" className="ml-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  )
}
