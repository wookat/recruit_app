/** 关键词同义扩展（轻量静态映射）：搜索时同时匹配同义词，后端以「a|b」OR 匹配。 */

const SYNONYMS: Record<string, string[]> = {
  研究生: ['硕士'],
  硕士: ['研究生'],
  大专: ['专科'],
  专科: ['大专'],
  老师: ['教师'],
  事业编: ['事业单位'],
  公务员: ['国考', '省考'],
}

export interface KeywordExpansion {
  /** 发给后端的关键词（含同义变体，「|」分隔）。 */
  expanded: string
  /** 额外匹配的同义词（用于提示「已同时匹配：××」），为空表示无扩展。 */
  added: string[]
}

/** 仅当整个关键词恰好命中词表时扩展（轻量策略，避免误替换）。 */
export function expandKeyword(keyword: string): KeywordExpansion {
  const kw = keyword.trim()
  const added = SYNONYMS[kw] ?? []
  if (!added.length) return { expanded: kw, added: [] }
  return { expanded: [kw, ...added].join('|'), added }
}

/** 关键词的同义候选（整词命中词表才返回，供无结果提示「试试同义词」）。 */
export function getSynonyms(keyword: string): string[] {
  return SYNONYMS[keyword.trim()] ?? []
}

/** 热门搜索建议词（无结果空态展示，可点直搜）。 */
export const HOT_SEARCHES = [
  '国考',
  '省考',
  '事业单位',
  '选调生',
  '教师',
  '护士',
  '银行',
  '央企',
  '国企',
  '三支一扶',
]
