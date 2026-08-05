import { t } from './i18n'
import type { Position, CampusJob, BianzhiJob } from '@/api'

/** 从现有字段派生的岗位标签；仅在字段明确时给出，不做猜测。 */
export interface JobTag {
  key: string
  label: string
}

function has(text: string | null | undefined, kw: string): boolean {
  return !!text && text.includes(kw)
}

function isUnlimited(text: string | null | undefined): boolean {
  const t = (text || '').trim()
  return t === '不限' || t === '专业不限' || t === '不限专业'
}

export function derivePositionTags(p: Position): JobTag[] {
  const tags: JobTag[] = []
  if (has(p.special_requirements, '应届') && !has(p.special_requirements, '非应届')) {
    tags.push({ key: 'fresh', label: t('应届可报') })
  }
  if (isUnlimited(p.undergrad_major) || isUnlimited(p.grad_major)) {
    tags.push({ key: 'anymajor', label: t('不限专业') })
  }
  if (has(p.special_requirements, '户籍不限') || has(p.special_requirements, '不限户籍')) {
    tags.push({ key: 'anyhukou', label: t('不限户籍') })
  }
  if (has(p.exam_type, '三支一扶') || has(p.job_type, '三支一扶')) {
    tags.push({ key: 'szyf', label: t('三支一扶') })
  }
  if (p.edu_level_norm === '本科') {
    tags.push({ key: 'edu_bk', label: t('本科可报') })
  }
  return tags
}

export function deriveCampusTags(j: CampusJob): JobTag[] {
  const tags: JobTag[] = []
  if (has(j.no_exam, '免')) {
    tags.push({ key: 'noexam', label: t('免笔试') })
  }
  if ((j.referral_code || '').trim()) {
    tags.push({ key: 'referral', label: t('有内推码') })
  }
  if (isUnlimited(j.major_requirement)) {
    tags.push({ key: 'anymajor', label: t('不限专业') })
  }
  return tags
}

export function deriveBianzhiTags(j: BianzhiJob): JobTag[] {
  const tags: JobTag[] = []
  if (isUnlimited(j.major_requirement)) {
    tags.push({ key: 'anymajor', label: t('不限专业') })
  }
  if (has(j.edu_requirement, '本科')) {
    tags.push({ key: 'edu_bk', label: t('本科可报') })
  }
  return tags
}
