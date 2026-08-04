const RELOAD_FLAG = 'recruit.chunkReloaded'

function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|Failed to fetch|does not provide an export named|Unexpected token/i.test(
    msg,
  )
}

/** SW 预缓存可能存入损坏 chunk（如 0 字节响应）；清空全部 caches 并注销 SW，刷新后重新拉取干净资源 */
async function purgeSwCaches(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    // 清理失败不阻塞刷新
  }
}

/** 空模块（0 字节 chunk）import 会成功但导出为 undefined，需与加载失败同样处理 */
function isEmptyModule(mod: unknown): boolean {
  return (
    typeof mod === 'object' &&
    mod !== null &&
    'default' in mod &&
    (mod as { default: unknown }).default === undefined
  )
}

function purgeAndReload<T>(): Promise<T> {
  sessionStorage.setItem(RELOAD_FLAG, '1')
  void purgeSwCaches().finally(() => window.location.reload())
  return new Promise<T>(() => {}) // 刷新中，挂起避免闪 ErrorBoundary
}

/**
 * 动态 import 失败自动恢复：部署后旧标签页请求已删 chunk 404、或 SW
 * 预缓存到损坏 chunk（空响应体导致缺 export/空模块）时，先清空
 * caches+注销 SW，再带 sessionStorage 防死循环标记整页刷新一次；
 * 刷新后仍失败才把错误抛给 ErrorBoundary。
 */
export function lazyRetry<T>(factory: () => Promise<T>): Promise<T> {
  return factory().then(
    (mod) => {
      if (isEmptyModule(mod) && sessionStorage.getItem(RELOAD_FLAG) !== '1') {
        return purgeAndReload<T>()
      }
      sessionStorage.removeItem(RELOAD_FLAG) // 加载成功后重置，下次部署仍可自动恢复一次
      return mod
    },
    (e: unknown) => {
      if (isChunkLoadError(e) && sessionStorage.getItem(RELOAD_FLAG) !== '1') {
        return purgeAndReload<T>()
      }
      throw e
    },
  )
}
