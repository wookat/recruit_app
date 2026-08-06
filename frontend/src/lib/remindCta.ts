import { getPushEnabled } from './push'

/** 收藏有截止日期岗位后的「开启截止提醒」toast 引导：每设备最多提示 2 次。 */

const COUNT_KEY = 'recruit.remindCtaShown'
const MAX_PROMPTS = 2

export const REMIND_CTA_EVENT = 'recruit-remind-cta'
export const REMIND_CONFIRM_EVENT = 'recruit-remind-confirm'

/** 「提醒我」等入口开启提醒成功后调用：弹全局确认 toast。 */
export function emitRemindConfirm(): void {
  window.dispatchEvent(new Event(REMIND_CONFIRM_EVENT))
}

let suppressed = false

/** 在回调期间抑制 toast 引导（如「提醒我」按钮已直接走开启流程时）。 */
export function suppressRemindCta<T>(fn: () => T): T {
  suppressed = true
  try {
    return fn()
  } finally {
    suppressed = false
  }
}

function getShownCount(): number {
  try {
    return Number(localStorage.getItem(COUNT_KEY)) || 0
  } catch {
    return 0
  }
}

/** 收藏了带截止日期的岗位后调用：未开推送且提示次数未用完时弹 toast 引导。 */
export function maybeShowRemindCta(): void {
  if (suppressed || getPushEnabled()) return
  const count = getShownCount()
  if (count >= MAX_PROMPTS) return
  try {
    localStorage.setItem(COUNT_KEY, String(count + 1))
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(REMIND_CTA_EVENT))
}
