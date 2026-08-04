# 上岸罗盘 R176 新版原型 · 设计说明（design-notes.md）

原型入口：`design/prototype/index.html`（纯静态 HTML + Tailwind CDN，可点击跳转；每页响应式，缩窄到 375px 即移动布局；右上角切换暗色模式）
走查报告：`design/prototype/audit-report.md` · 现状截图：`assets/screenshots/current/` · 原型截图：`assets/screenshots/new/`

## 1. 设计原则

1. **内容优先**：首屏 60% 以上留给岗位列表；一切控制项压缩为「一行场景 chips + 一行工具栏 + 一行已选条件」。
2. **一套骨架，三个板块**：体制内/校招/编制共用同一套 页头→场景 chips→工具栏→已选条件→列表 骨架与统一筛选面板，仅板块识别色与专属筛选项不同，学习成本一次付清。
3. **移动优先**：<640px 一律两行紧凑卡 + 底部 5 Tab + 底部 Sheet 浮层；禁用横向滚动表格；触控目标 ≥40px。
4. **状态即视觉**：截止紧迫度（红=今日/琥珀=3 天内/灰=正常）、板块归属（蓝/青/紫）、来源可信（绿=官方）都有固定色语义，扫一眼即得。
5. **现代分层**（对标 Linear/Vercel/shadcn）：page/card/raised 三级表面 + 三级阴影 + 半透明毛玻璃顶栏；描边弱化、层级靠底色与阴影表达；暗色模式为一等公民（所有令牌成对映射）。

## 2. 信息架构

```
顶部一级导航（桌面）/ 底部 5 Tab（移动）
├─ 体制内 positions.html（表格/卡片双视图）
├─ 校招 campus.html（卡片为主）
├─ 编制 bianzhi.html（公告表格 + 省份分布）
├─ 日历 calendar.html（月/周/议程 + 当日事件侧栏）
├─ 今日更新 updates.html（统计卡 + 时间轴）
├─ 攻略 guide.html（独立页 + 粘性目录）
├─ 全局搜索（Ctrl K 弹层，任意页）→ 聚合结果 search-results.html（板块 Tab）
└─ 我的收藏 favorites.html
   ├─ 收藏列表（投递漏斗 + 临期置顶）
   └─ 提醒与同步设置（截止提醒 / 推送订阅 / 跨设备同步码）
```

关键变化：三板块从「预设 pill 里的外链」升级为一级导航；「今日更新/日历/攻略」从顶栏图标堆退居一级导航文字项；收藏面板从抽屉升级为页面并拆分「内容 / 设置」两页签；同步码从「更多」深处提到设置页签常驻。

## 3. 新旧对照表

| 页面 | 现状截图 | 原型截图 | 主要改动与理由 |
|---|---|---|---|
| 体制内列表 | current/desktop-positions.png | new/desktop-positions.png | 【P0-1】删横幅/一键匹配大块/两行 pill/速览条，压缩为 1 行 chips + 1 行工具栏，桌面首屏即见表格；一键匹配移入右栏卡片；截止提醒压缩为可展开横条 |
| 体制内列表（移动） | current/mobile-positions-full.png | new/mobile-positions.png | 【P0-2】表格改两行紧凑卡（标题+单位 / 标签+截止），一屏约 5 条；底部 5 Tab 加搜索入口 |
| 卡片视图 | current/desktop-card-view.png | new/desktop-positions-cards.png | 卡片补齐截止/学历/地点锚点，今日截止卡加红色描边强调 |
| 统一筛选 | current/desktop-filter-open.png / mobile-filter-open.png | new/desktop-filter-open.png / mobile-filter-open.png | 【P0-3/P1-3】8 个平铺下拉改为「时间/地点/学历/类型/更多」分组 chips；地点改省-市级联多选面板（原需 3 次下拉）；底部常驻「查看 N 条结果」+「保存此筛选」 |
| 保存筛选 | current/desktop-positions.png（页脚文字链） | new/desktop-saved-filters.png | 【P1-4】升级为管理弹层：命名保存/应用/改名/删除/上新订阅开关/导出与链接 |
| 岗位详情抽屉 | current/desktop-detail-drawer.png | new/desktop-detail-drawer.png / mobile-detail-drawer.png | 【P1-2】新增锚点页签（基本信息/条件/竞争/时间/来源）；图标按钮改文字按钮（立即报名/已收藏/状态/对比）；时间安排改时间线控件；官方来源绿徽保留 |
| 全局搜索 | current/desktop-global-search.png | new/desktop-global-search.png | 【P1-7】空态补热门搜索/最近搜索/功能直达；移动端底部 Tab 提供搜索入口 |
| 聚合搜索结果 | current/desktop-search-results.png | new/desktop-search-results.png | 【P2-6】新增板块 Tab+计数条（全部/体制内/校招/编制），全部视图每板块 Top3+查看全部，无需长滚动比较 |
| 收藏面板 | current/desktop-favorites.png / mobile-favorites.png | new/desktop-favorites.png / mobile-favorites.png | 【P1-5】设置块移入「提醒与同步设置」页签；列表以投递状态漏斗组织，3 天内截止自动置顶并给主操作「去报名」 |
| 报考日历 | current/desktop-calendar.png / mobile-calendar.png | new/desktop-calendar.png / mobile-calendar.png | 【P2-4】月格内直接显示收藏岗位名与分类计数条（原只有数字角标）；新增当日事件侧栏；图例与筛选合并为一行 chips |
| 今日更新 | current/desktop-updates.png | new/desktop-updates.png | 【P2-5】新增三板块统计卡；行升级为 logo 位+标签+时间戳；尾部订阅推送引导 |
| 攻略 | current/desktop-guide.png | new/desktop-guide.png | 【P3-4】抽屉改独立页：粘性目录 + 三赛道卡片 + 公务员流程时间线 + 校招时间线色块 |
| 数据看板侧栏 | current/desktop-positions.png（右栏） | new/desktop-positions.png（右栏） | 【P2-3】年份改横向条形图，考试类型/省份改计数 chips，「点击筛选」交互暗示更强 |
| 暗色模式 | —（现状对比度不足） | new/desktop-positions-dark.png / mobile-calendar-dark.png | 【P3-3】全令牌成对映射（page/card/ink/line/标签浅底→深底），对比度达 AA |
| 跨设备同步码 | current/desktop-favorites.png（更多菜单内） | new/desktop-favorites.png（设置页签） | 【P3-5】常驻设置页签：大号等宽同步码 + 复制/刷新 + 输入框 + 上次同步记录 |

## 4. 设计令牌（摘要，完整见 assets/tokens.js 与 tokens.html）

- **品牌色**：brand 50–950（主 600 #1a66f5）；板块识别色 体制内 #1a66f5 / 校招 #0ea5a4 / 编制 #8b5cf6；语义色 danger #e11d48 / warn #d97706 / ok #059669。
- **表面**：page #f7f8fa / card #fff / sunken #f1f3f6；暗色 #0b0e14 / #121722 / #0e121b。文本三级 ink-1/2/3 成对映射。
- **字阶**：12/13/14/16/18/22/28，正文 14/22。
- **圆角**：6（标签）/10（按钮、输入）/14（卡片）/20（移动 Sheet）。**阴影**：card/raised/overlay 三级。
- **组件**：btn-pri/sec/ghost、chip/chip-on、tag-*（7 色）、input、tbl、drawer/sheet-m/overlay-mask（规范页 tokens.html 可实时预览亮暗两态）。

## 5. 落地建议（供后续开发参考，本轮不改线上代码）

1. 令牌可直接搬进 `frontend/src/index.css` 的 Tailwind v4 `@theme`；组件类对应 shadcn/ui 的 Button/Badge/Sheet/Dialog 变体。
2. 建议分四步实施：① 令牌+顶栏/底栏 → ② 列表页首屏重排 → ③ 统一筛选面板 → ④ 收藏/日历/更新页改版，每步可独立上线回归。
3. 表格虚拟滚动（TanStack Virtual）与现有数据层不受影响，本次仅重排展示层。
