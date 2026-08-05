import { getLang, t, tt } from './i18n'

const SITE_URL = 'https://jobs.zalize.com/'

const CAMPUS_PRESET_LABELS: Record<string, string> = {
  noexam: '免笔试',
  referral: '内推码',
  intern: '实习',
  autumn: '秋招',
  recent7: '近 7 天新增',
}

const BIANZHI_PRESET_LABELS: Record<string, string> = {
  edu: '教师招聘',
  med: '医疗招聘',
}

function setMeta(selector: string, content: string) {
  document.querySelector(selector)?.setAttribute('content', content)
}

function setLink(rel: string, href: string, hreflang?: string) {
  const sel = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]:not([hreflang])`
  let el = document.head.querySelector<HTMLLinkElement>(sel)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    if (hreflang) el.hreflang = hreflang
    document.head.appendChild(el)
  }
  el.href = href
}

/** canonical 指向去 lang 参数的当前 URL；hreflang 提供 zh/en/x-default 变体 */
function applyAlternates() {
  const q = new URLSearchParams(window.location.search)
  q.delete('lang')
  const qs = q.toString()
  const base = `${SITE_URL.replace(/\/$/, '')}${window.location.pathname}${qs ? `?${qs}` : ''}`
  const withLang = (lang: string) => `${base}${qs ? '&' : '?'}lang=${lang}`
  setLink('canonical', base)
  setLink('alternate', withLang('zh'), 'zh-CN')
  setLink('alternate', withLang('en'), 'en')
  setLink('alternate', base, 'x-default')
}

export function applySeo(
  mode: 'positions' | 'campus' | 'bianzhi' | 'calendar' | 'updates' | 'search' | 'all',
  preset?: string,
  keyword?: string,
) {
  const SITE = t('上岸雷达')
  let title = t('上岸雷达 - 公务员/事业编/校招一站式岗位检索')
  let desc = t(
    '上岸雷达：全国体制内岗位一站式检索平台，覆盖公务员、事业编、军队文职、国企招聘，支持专业、学历、地区快速匹配，助你找准上岸方向。',
  )
  if (mode === 'all') {
    title = tt`全部岗位 - 体制内/校招/编制统一检索 | ${SITE}`
    desc = t('体制内岗位、校招信息、编制公告三大板块合并为一个统一列表，一套筛选横跨全部岗位：板块、省市、学历、关键词、截止日期一次搜定。')
  } else if (mode === 'calendar') {
    title = tt`截止日历 - ${SITE}`
    desc = t('未来 60 天校招与编制公告报名截止汇总日历，按日期查看当日截止岗位，不错过每一个报名窗口。')
  } else if (mode === 'search') {
    const kw = (keyword || '').trim().slice(0, 30)
    title = kw ? tt`「${kw}」相关岗位 - 三板块聚合搜索 | ${SITE}` : tt`聚合搜索 - ${SITE}`
    desc = kw
      ? tt`在体制内、校招、编制三大板块中搜索「${kw}」相关岗位与公告，关键词高亮、可直达岗位详情与官方公告。`
      : t('体制内、校招、编制三板块聚合搜索，一次搜索同时命中岗位、公告与校招信息。')
  } else if (mode === 'updates') {
    title = tt`近 7 天更新 - ${SITE}`
    desc = t('体制内、校招、编制三板块近 7 天新增岗位按日聚合，每日自动同步，新机会一目了然。')
  } else if (mode === 'campus') {
    const label = preset ? CAMPUS_PRESET_LABELS[preset] : undefined
    title = tt`校招信息${label ? `·${t(label)}` : ''} - ${SITE}`
    desc = tt`央国企、银行、事业单位校园招聘信息每日增量更新${label ? tt`，当前视图：${t(label)}` : ''}，含免笔试、内推码、实习与秋招专区。`
  } else if (mode === 'bianzhi') {
    const label = preset ? BIANZHI_PRESET_LABELS[preset] : undefined
    title = tt`编制公告${label ? `·${t(label)}` : ''} - ${SITE}`
    desc = tt`教师招聘、医疗招聘等编制公告汇总${label ? tt`，当前视图：${t(label)}` : ''}，每日更新，支持省份与分类筛选。`
  }
  document.title = title
  setMeta('meta[name="description"]', desc)
  setMeta('meta[property="og:title"]', title)
  setMeta('meta[property="og:description"]', desc)
  setMeta('meta[name="twitter:title"]', title)
  setMeta('meta[name="twitter:description"]', desc)
  setMeta('meta[property="og:locale"]', getLang() === 'en' ? 'en_US' : 'zh_CN')
  applyAlternates()
}
