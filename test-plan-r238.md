# R238 线上回归测试计划 — jobs.zalize.com（提醒我按钮 / 收藏 toast 引导 / 推送开关文案）

目标: https://jobs.zalize.com/?qa=1&lang=zh ，bundle index-1LAqXDZF.js（已确认线上一致）。
方法: Chrome (CDP :29229) + Playwright grant_permissions 授权通知；测试前清 localStorage/SW。全程录屏。

代码依据:
- RemindMeButton.tsx:24 仅 deadline 且 daysUntil>=0 且 push 支持时渲染；成功后「已设提醒」；denied 显示 amber 提示。
- remindCta.ts:31-41 localStorage `recruit.remindCtaShown`，最多 2 次；RemindToastHost.tsx 10s 自动消失。
- FavoritesSheet.tsx:1919-1945 开关文案「截止前 N 天提醒你报名」+ 描述「关闭网页也能收到，还会推送订阅筛选的上新」。
- PositionSheet.tsx:351 / BoardJobSheet.tsx:275 集成。

## T1 桌面 1280+ 亮色: RemindMeButton 显示
- 清 localStorage，打开首页，从「今日截止/即将截止」或编制板块打开一个有未过期截止日期的岗位详情。
- PASS: 详情操作区显示「提醒我」按钮（铃铛图标）+ 旁注「截止前 3 天提醒你报名」；截图。
- 反例: 打开一个已过期岗位（如状态为已截止），PASS: 无「提醒我」按钮。

## T2 收藏 toast（B2）及次数上限
- 在未授权通知、localStorage 已清状态下，收藏第 1 个有截止日期岗位 → PASS: 底部弹 toast「已收藏」+「开启截止提醒」按钮，截图。
- 关闭 toast/等待，收藏第 2 个有截止岗位 → PASS: toast 再次出现。
- 收藏第 3 个 → PASS: toast 不出现；localStorage recruit.remindCtaShown == "2"。

## T3 toast 授权流程
- 用 Playwright context.grant_permissions(['notifications']) 后触发 toast（或重清计数），点「开启截止提醒」。
- PASS: toast 变「已开启：截止前 3 天提醒你报名（关闭网页也能收到）」；Network 出现 POST /api/push/subscribe 200。

## T4 「提醒我」点击 → 已设提醒
- 权限已授予，打开另一个有截止岗位详情，点「提醒我」。
- PASS: 按钮变「已设提醒」(绿勾)；岗位被收藏（星标激活）；POST /api/push/subscribe 200。

## T5 收藏面板开关文案（B3）
- 点顶部星标打开「我的收藏」，滚到底部设置区。
- PASS: 开关标签为「截止前 3 天提醒你报名」，描述含「关闭网页也能收到，还会推送订阅筛选的上新」；截图。

## T6 移动 375px 视口 + 暗色模式
- 375px 视口亮色: 重复 T1（按钮布局不溢出）+ toast 显示 + 收藏面板开关文案，各截图。
- 暗色模式（UI 主题切换）桌面: 按钮 / toast / 开关文案截图正常。

## T7 拒绝权限内联提示（可行则测）
- 新 context 权限 denied 下点「提醒我」 → PASS: amber 内联提示「浏览器拒绝了通知权限…」。

## 全局
- 全程 console 0 error（browser_console 检查）。
