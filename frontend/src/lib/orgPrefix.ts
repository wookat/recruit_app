/** 展示层去掉岗位名开头的单位/公司名前缀（含衔接符）与长数字岗位代码，避免冗余、提升可读性。
 * 标题整体只是一串数字岗位代码时无阅读价值，回退到 fallback（如岗位类别）。 */
export function stripOrgPrefix(
  title: string,
  org: string | null | undefined,
  fallback?: string | null,
): string {
  let t = title
  if (org && t.startsWith(org)) {
    t = t.slice(org.length).replace(/^[\s\-—·：:]+/, '') || t
  }
  const noCode = t.replace(/^\d{10,}[\s\-—·：:]*/, '')
  const result = noCode || t
  if (/^\d{10,}$/.test(result.trim()) && fallback?.trim()) {
    return fallback.trim()
  }
  return result
}
