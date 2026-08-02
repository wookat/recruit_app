const RELOAD_FLAG = 'recruit.chunkReloaded'

function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|Failed to fetch/i.test(
    msg,
  )
}

/**
 * 动态 import 失败自动恢复：部署后旧标签页请求已删 chunk 404 时，
 * 带 sessionStorage 防死循环标记整页刷新一次拿新资源清单；
 * 刷新后仍失败才把错误抛给 ErrorBoundary。
 */
export function lazyRetry<T>(factory: () => Promise<T>): Promise<T> {
  return factory().then(
    (mod) => {
      sessionStorage.removeItem(RELOAD_FLAG) // 加载成功后重置，下次部署仍可自动恢复一次
      return mod
    },
    (e: unknown) => {
      if (isChunkLoadError(e) && sessionStorage.getItem(RELOAD_FLAG) !== '1') {
        sessionStorage.setItem(RELOAD_FLAG, '1')
        window.location.reload()
        return new Promise<T>(() => {}) // 刷新中，挂起避免闪 ErrorBoundary
      }
      throw e
    },
  )
}
