/** 展示层去掉岗位名开头的单位/公司名前缀（含衔接符），避免「单位：岗位」冗余。 */
export function stripOrgPrefix(title: string, org: string | null | undefined): string {
  if (!org || !title.startsWith(org)) return title
  return title.slice(org.length).replace(/^[\s\-—·：:]+/, '') || title
}
