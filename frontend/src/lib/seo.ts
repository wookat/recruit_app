const SITE = '上岸罗盘'

const DEFAULT_TITLE = '上岸罗盘 - 公务员/事业编/校招一站式岗位检索'
const DEFAULT_DESC =
  '上岸罗盘：全国体制内岗位一站式检索平台，覆盖公务员、事业编、军队文职、国企招聘，支持专业、学历、地区快速匹配，助你找准上岸方向。'

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

export function applySeo(mode: 'positions' | 'campus' | 'bianzhi', preset?: string) {
  let title = DEFAULT_TITLE
  let desc = DEFAULT_DESC
  if (mode === 'campus') {
    const label = preset ? CAMPUS_PRESET_LABELS[preset] : undefined
    title = `校招信息${label ? `·${label}` : ''} - ${SITE}`
    desc = `央国企、银行、事业单位校园招聘信息每日增量更新${label ? `，当前视图：${label}` : ''}，含免笔试、内推码、实习与秋招专区。`
  } else if (mode === 'bianzhi') {
    const label = preset ? BIANZHI_PRESET_LABELS[preset] : undefined
    title = `编制公告${label ? `·${label}` : ''} - ${SITE}`
    desc = `教师招聘、医疗招聘等编制公告汇总${label ? `，当前视图：${label}` : ''}，每日更新，支持省份与分类筛选。`
  }
  document.title = title
  document.querySelector('meta[name="description"]')?.setAttribute('content', desc)
}
