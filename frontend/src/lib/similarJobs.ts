import {
  fetchBianzhiJobs,
  fetchCampusJobs,
  type BianzhiJob,
  type CampusJob,
} from '@/api'

/** 相似岗位推荐：校招按同行业+同城市、编制按同分类+同省，各取 5 条，10 分钟缓存。 */

const TTL = 10 * 60 * 1000
const cache = new Map<string, { at: number; items: unknown[] }>()

async function cachedFetch<T>(key: string, run: () => Promise<T[]>): Promise<T[]> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.items as T[]
  const items = await run()
  cache.set(key, { at: Date.now(), items })
  return items
}

/** 从多城市文本（如「北京/上海、深圳」）取第一个城市。 */
export function firstCity(locations: string | null | undefined): string | null {
  const c = (locations ?? '').split(/[、，,/;；|\s]+/)[0]?.trim()
  return c || null
}

export async function fetchSimilarCampus(job: CampusJob): Promise<CampusJob[]> {
  const industry = job.industry?.trim() || null
  const city = firstCity(job.locations)
  if (!industry && !city) return []
  const key = `campus|${industry ?? ''}|${city ?? ''}`
  const items = await cachedFetch(key, () =>
    fetchCampusJobs({
      ...(industry ? { industry: [industry] } : undefined),
      ...(city ? { location: city } : undefined),
      hide_expired: true,
      page: 1,
      page_size: 12,
    }).then((r) => r.items),
  )
  return items.filter((j) => j.id !== job.id).slice(0, 5)
}

export async function fetchSimilarBianzhi(job: BianzhiJob): Promise<BianzhiJob[]> {
  const category = job.category?.trim() || null
  const province = job.province?.trim() || null
  if (!category && !province) return []
  const key = `bianzhi|${category ?? ''}|${province ?? ''}`
  const items = await cachedFetch(key, () =>
    fetchBianzhiJobs({
      ...(category ? { category: [category] } : undefined),
      ...(province ? { province: [province] } : undefined),
      hide_expired: true,
      page: 1,
      page_size: 12,
    }).then((r) => r.items),
  )
  return items.filter((j) => j.id !== job.id).slice(0, 5)
}
