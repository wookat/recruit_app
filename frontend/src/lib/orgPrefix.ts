/** 展示层去掉岗位名开头的单位/公司名前缀（含衔接符）与长数字岗位代码，避免冗余、提升可读性。 */
export function stripOrgPrefix(title: string, org: string | null | undefined): string {
  let t = title
  if (org && t.startsWith(org)) {
    t = t.slice(org.length).replace(/^[\s\-—·：:]+/, '') || t
  }
  const noCode = t.replace(/^\d{10,}[\s\-—·：:]*/, '')
  return noCode || t
}
