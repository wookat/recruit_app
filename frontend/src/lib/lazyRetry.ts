const RELOAD_AT_KEY = 'recruit.chunkReloadedAt'
const RELOAD_COOLDOWN_MS = 10 * 60 * 1000

/** 冷却期内只自愈刷新一次，避免持久性崩溃导致刷新死循环；过期后下次部署仍可自愈 */
function inReloadCooldown(): boolean {
  const ts = Number(sessionStorage.getItem(RELOAD_AT_KEY))
  return ts > 0 && Date.now() - ts < RELOAD_COOLDOWN_MS
}

function markReloaded(): void {
  sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()))
}

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
    // 绕过 HTTP 缓存重取当前页 HTML，避免刷新后仍拿到旧 index.html
    await fetch(window.location.href, { cache: 'reload' })
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

/**
 * 渲染崩溃时的自愈入口：清 caches+注销 SW 后整页刷新一次（防死循环标记），
 * 覆盖旧缓存 chunk 与新代码不匹配导致的运行时异常；已刷过则返回 false 交给错误卡。
 */
export function purgeReloadOnce(): boolean {
  if (inReloadCooldown()) return false
  markReloaded()
  void purgeSwCaches().finally(() => window.location.reload())
  return true
}

/** 用户手动点「点击刷新」时的彻底清理路径：不受冷却限制，注销 SW+清 precache+强刷。 */
export function forcePurgeReload(): void {
  markReloaded()
  void purgeSwCaches().finally(() => window.location.reload())
}

function purgeAndReload<T>(): Promise<T> {
  markReloaded()
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
      if (isEmptyModule(mod) && !inReloadCooldown()) {
        return purgeAndReload<T>()
      }
      return mod
    },
    (e: unknown) => {
      if (isChunkLoadError(e) && !inReloadCooldown()) {
        return purgeAndReload<T>()
      }
      throw e
    },
  )
}
