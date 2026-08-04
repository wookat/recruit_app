/**
 * 分类色板：飞书多维表格风格的柔和底色 + 深色文字标签（亮暗双模式）。
 * 统一模式：bg-{c}-100 text-{c}-700 + dark:bg-{c}-950 dark:text-{c}-300（见 DESIGN.md §1.3）。
 */

export type Tone =
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'rose'
  | 'slate'

/** 亮色下更深的文字色（-900 级），用于小字号统计 chips 达到 4.5:1 对比度；暗色保持 -300。 */
export const TONE_TEXT_STRONG: Record<Tone, string> = {
  red: 'text-red-900 dark:text-red-300',
  orange: 'text-orange-900 dark:text-orange-300',
  amber: 'text-amber-900 dark:text-amber-300',
  yellow: 'text-yellow-900 dark:text-yellow-300',
  lime: 'text-lime-900 dark:text-lime-300',
  green: 'text-green-900 dark:text-green-300',
  emerald: 'text-emerald-900 dark:text-emerald-300',
  teal: 'text-teal-900 dark:text-teal-300',
  cyan: 'text-cyan-900 dark:text-cyan-300',
  sky: 'text-sky-900 dark:text-sky-300',
  blue: 'text-blue-900 dark:text-blue-300',
  indigo: 'text-indigo-900 dark:text-indigo-300',
  violet: 'text-violet-900 dark:text-violet-300',
  purple: 'text-purple-900 dark:text-purple-300',
  fuchsia: 'text-fuchsia-900 dark:text-fuchsia-300',
  pink: 'text-pink-900 dark:text-pink-300',
  rose: 'text-rose-900 dark:text-rose-300',
  slate: 'text-slate-900 dark:text-slate-300',
}

export const TONE_CLASSES: Record<Tone, string> = {
  red: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 [&_[data-count]]:text-red-900 dark:[&_[data-count]]:text-red-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300 [&_[data-count]]:text-orange-900 dark:[&_[data-count]]:text-orange-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 [&_[data-count]]:text-amber-900 dark:[&_[data-count]]:text-amber-300',
  yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300 [&_[data-count]]:text-yellow-900 dark:[&_[data-count]]:text-yellow-300',
  lime: 'bg-lime-100 text-lime-700 dark:bg-lime-950 dark:text-lime-300 [&_[data-count]]:text-lime-900 dark:[&_[data-count]]:text-lime-300',
  green: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 [&_[data-count]]:text-green-900 dark:[&_[data-count]]:text-green-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 [&_[data-count]]:text-emerald-900 dark:[&_[data-count]]:text-emerald-300',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300 [&_[data-count]]:text-teal-900 dark:[&_[data-count]]:text-teal-300',
  cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300 [&_[data-count]]:text-cyan-900 dark:[&_[data-count]]:text-cyan-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300 [&_[data-count]]:text-sky-900 dark:[&_[data-count]]:text-sky-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 [&_[data-count]]:text-blue-900 dark:[&_[data-count]]:text-blue-300',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 [&_[data-count]]:text-indigo-900 dark:[&_[data-count]]:text-indigo-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 [&_[data-count]]:text-violet-900 dark:[&_[data-count]]:text-violet-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 [&_[data-count]]:text-purple-900 dark:[&_[data-count]]:text-purple-300',
  fuchsia: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300 [&_[data-count]]:text-fuchsia-900 dark:[&_[data-count]]:text-fuchsia-300',
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300 [&_[data-count]]:text-pink-900 dark:[&_[data-count]]:text-pink-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 [&_[data-count]]:text-rose-900 dark:[&_[data-count]]:text-rose-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 [&_[data-count]]:text-slate-900 dark:[&_[data-count]]:text-slate-300',
}

/** hash 兜底色板（不含语义保留色 red/slate，避免误读为危险/禁用）。 */
const HASH_TONES: Tone[] = [
  'blue',
  'green',
  'violet',
  'orange',
  'cyan',
  'pink',
  'indigo',
  'teal',
  'amber',
  'purple',
  'sky',
  'rose',
  'lime',
  'fuchsia',
  'emerald',
]

export function hashTone(value: string): Tone {
  let h = 0
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0
  }
  return HASH_TONES[Math.abs(h) % HASH_TONES.length]
}

const JOB_TYPE_TONES: Record<string, Tone> = {
  公务员: 'blue',
  '事业单位/事业编': 'violet',
  军队文职: 'green',
  '央企/国企': 'red',
  '国企/央企': 'red',
  选调生: 'orange',
  三支一扶: 'cyan',
  教师: 'pink',
  银行: 'indigo',
  上市公司: 'teal',
  其他企业: 'slate',
}

export function jobTypeClass(value: string | null | undefined): string {
  if (!value) return TONE_CLASSES.slate
  return TONE_CLASSES[JOB_TYPE_TONES[value] || hashTone(value)]
}

export function yearClass(year: number | null | undefined): string {
  if (!year) return TONE_CLASSES.slate
  if (year >= 2027) return TONE_CLASSES.blue
  if (year === 2026) return TONE_CLASSES.sky
  return TONE_CLASSES.slate
}

const EDU_TONES: Record<string, Tone> = {
  '大专/中专': 'teal',
  本科: 'blue',
  硕士研究生: 'violet',
  博士研究生: 'purple',
  '其他/不限': 'slate',
}

export function eduClass(value: string | null | undefined): string {
  if (!value) return TONE_CLASSES.slate
  return TONE_CLASSES[EDU_TONES[value] || hashTone(value)]
}

export function provinceClass(value: string | null | undefined): string {
  if (!value) return TONE_CLASSES.slate
  return TONE_CLASSES[hashTone(value.slice(0, 3))]
}

export const APP_CHANNELS = ['官网', '内推', '邮箱', '招聘平台', '现场招聘', '其他'] as const
export type AppChannel = (typeof APP_CHANNELS)[number]

const CHANNEL_TONES: Record<AppChannel, Tone> = {
  官网: 'blue',
  内推: 'green',
  邮箱: 'orange',
  招聘平台: 'cyan',
  现场招聘: 'violet',
  其他: 'slate',
}

export function channelClass(value: AppChannel): string {
  return TONE_CLASSES[CHANNEL_TONES[value] || 'slate']
}

/** 通用彩色标签样式（与状态 pill 一致的胶囊形态）。 */
export const PILL_BASE = 'inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-medium whitespace-nowrap'
