import { EN } from './i18n.en'

export type Lang = 'zh' | 'en'

const STORAGE_KEY = 'recruit.lang'

function detectLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (q === 'en' || q === 'zh') {
      try {
        localStorage.setItem(STORAGE_KEY, q)
      } catch {
        // ignore
      }
      return q
    }
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'zh') return stored
  } catch {
    // ignore
  }
  const nav = (navigator.language || '').toLowerCase()
  return nav.startsWith('zh') ? 'zh' : 'en'
}

/** 语言在启动时确定；切换语言时持久化后整页刷新，保证模块级常量同步更新 */
const lang: Lang = detectLang()
document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'

export function getLang(): Lang {
  return lang
}

export function setLang(next: Lang): void {
  if (next === lang) return
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // ignore
  }
  const q = new URLSearchParams(window.location.search)
  if (q.get('lang')) {
    q.set('lang', next)
    window.history.replaceState(null, '', `?${q.toString()}${window.location.hash}`)
  }
  window.location.reload()
}

const missing = new Set<string>()

/** 以中文原文为 key 查英文文案；缺失时回退中文并在 dev 控制台告警 */
export function t(zh: string): string {
  if (lang === 'zh') return zh
  const en = EN[zh]
  if (en !== undefined) return en
  if (import.meta.env.DEV && !missing.has(zh)) {
    missing.add(zh)
    console.warn(`[i18n] missing EN for: ${zh}`)
  }
  return zh
}

/** 模板插值版：tt`共 ${n} 条` → EN 字典 key 为 '共 {0} 条' */
export function tt(strings: TemplateStringsArray, ...values: unknown[]): string {
  const key = strings.raw.reduce((acc, s, i) => acc + (i > 0 ? `{${i - 1}}` : '') + s, '')
  const pattern = lang === 'zh' ? key : (EN[key] ?? key)
  if (lang !== 'zh' && EN[key] === undefined && import.meta.env.DEV && !missing.has(key)) {
    missing.add(key)
    console.warn(`[i18n] missing EN for: ${key}`)
  }
  return pattern.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? ''))
}
