import { buildBackup, restoreBackup, type RestoreResult } from '@/lib/backup'

const PREFIX = 'SC1:'
/** 超过该长度提示改用备份文件（粘贴超长文本易被聊天工具截断）。 */
export const SYNC_CODE_MAX = 30000

const PROFILE_KEY = 'recruit.profile'
const PREF_KEYS = [
  'recruit.remindDays',
  'recruit.savedFilters',
  'recruit.savedQueries',
  'recruit.savedFilterBaselines',
]

interface SyncPayload {
  app: 'recruit-sync'
  version: number
  backup: ReturnType<typeof buildBackup>
  profile: string | null
  prefs: Record<string, string>
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function gzipText(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzipBytes(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

export function isSyncCodeSupported(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

/** 生成同步码：收藏/画像/偏好 gzip+base64 成短文本。 */
export async function generateSyncCode(): Promise<string> {
  const prefs: Record<string, string> = {}
  for (const k of PREF_KEYS) {
    const v = localStorage.getItem(k)
    if (v !== null) prefs[k] = v
  }
  const payload: SyncPayload = {
    app: 'recruit-sync',
    version: 1,
    backup: buildBackup(),
    profile: localStorage.getItem(PROFILE_KEY),
    prefs,
  }
  return PREFIX + bytesToBase64(await gzipText(JSON.stringify(payload)))
}

export interface SyncImportResult extends RestoreResult {
  profileApplied: boolean
  prefsApplied: number
}

/** 导入同步码并合并：收藏走备份合并语义；画像/偏好仅填充本机缺失项。 */
export async function importSyncCode(code: string): Promise<SyncImportResult> {
  const trimmed = code.trim()
  if (!trimmed.startsWith(PREFIX)) throw new Error('不是有效的同步码（应以 SC1: 开头）')
  let json: string
  try {
    json = await gunzipBytes(base64ToBytes(trimmed.slice(PREFIX.length)))
  } catch {
    throw new Error('同步码解码失败，请确认完整复制')
  }
  let payload: SyncPayload
  try {
    payload = JSON.parse(json) as SyncPayload
  } catch {
    throw new Error('同步码内容损坏')
  }
  if (payload.app !== 'recruit-sync' || typeof payload.version !== 'number') {
    throw new Error('不是上岸雷达的同步码')
  }
  const restored = restoreBackup(JSON.stringify(payload.backup))

  let profileApplied = false
  if (payload.profile && !localStorage.getItem(PROFILE_KEY)) {
    localStorage.setItem(PROFILE_KEY, payload.profile)
    profileApplied = true
  }
  let prefsApplied = 0
  for (const [k, v] of Object.entries(payload.prefs ?? {})) {
    if (PREF_KEYS.includes(k) && localStorage.getItem(k) === null) {
      localStorage.setItem(k, v)
      prefsApplied += 1
    }
  }
  return { ...restored, profileApplied, prefsApplied }
}
