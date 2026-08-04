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

---

# R178 组件库现代化记录（2026-08-04）

老板反馈：「圆形」用得太多显得设计老。R178 对齐 2025 主流规范（shadcn/ui、Linear、Vercel Geist），全站 11 页统一套用，无新旧混用。

## 1. 圆角分层（去胶囊化）
- 新令牌层级（tokens.css）：`--radius-sm: 4px`（tag/badge）、`--radius-md: 6px`（chips/segmented，Tailwind 别名 `rounded-ctl`）、`--radius: 8px`（按钮/输入框/下拉）、`--radius-lg: 12px`（卡片/面板/弹层）、`--radius-xl: 16px`（移动 Sheet）。
- `rounded-full` 仅保留：头像、开关、圆形图标钮、状态小圆点、进度条；移除全部胶囊 chips 与胶囊状态演示条。

## 2. Chips / 预设 / 计数徽章
- `.chip`：6px 方角轻量 tag，默认细 1px 中性边框 + 卡片底；高度 7→6（28→24px），密度收紧。
- `.chip-on` 选中态：由「重蓝底白字」改为「细主色边框 + primary/10 浅底 + brand-700 文字」（浅底对比约 8.4:1 ≥ AA）；暗色用 brand-300 文字 + brand-400/15 浅底。
- 新增 `.count-badge`：4px 角、primary/10 浅底、主色文字，替换顶栏收藏计数与筛选角标（原 rounded-full 白字圆点）。

## 3. Segmented Control
- 新增 `.seg / .seg-item / .seg-on`：外容器 8px 角 + muted 底 + hairline，选中项 6px 角白卡底 + xs 阴影。
- 应用于：positions/positions-cards/campus 的表格↔卡片视图切换、calendar 的月/周/议程切换（替换原「蓝底白字拼接按钮组」，JS calView 同步改 seg 类切换）。

## 4. 质感现代化
- 灰阶改低饱和 zinc/neutral：background zinc-50、border zinc-200 hairline、muted-foreground zinc-500；暗色 zinc-950 基调。
- 阴影收敛：card→xs（1px 投影）、raised→sm、overlay 减淡；层次优先由 1px hairline 边框表达；btn-sec 增加 xs 阴影（Geist 风格）。
- 密度收紧一级：btn h-9→h-8、btn-sm h-8→h-7、input h-9→h-8、chips h-7→h-6、表格 td py-3→py-2.5 / th py-2.5→py-2、navlink h-9→h-8。

## 5. tokens.html 升级为「组件库规范」
- 新增圆角分层表（含 full 使用禁令）、segmented 规范、count-badge、R176/R177/R178 三代选中态对比示例；阴影示例改 xs/sm 分层说明。

---

# R177 高保真升级记录（2026-08-04）

## 1. 严格设计系统：tokens.css 单一事实来源

- 新增 **`assets/tokens.css`**：以 shadcn/ui + Radix 语义令牌为基准的完整 CSS variables 色板（`--background/--foreground/--card/--popover/--primary/--secondary/--muted/--accent/--destructive/--border/--input/--ring` + brand 50–950 + 板块色 + 状态色），亮/暗两套由 `.dark` 类翻转；圆角（6/10/14/20）、三级阴影、骨架动画、Sheet 手势把手也定义于此。
- **`assets/tokens.js` 重写为纯别名映射**：所有 Tailwind 颜色都指向 `hsl(var(--x))`，页面内不再写死任何色值，杜绝令牌漂移；R176 的 `surface-*/ink-*/line` 类名保留兼容（亮暗同变量，自动切换）。
- 全部 11 个页面 `<head>` 统一引用同一份 `tokens.css`（ui.js 内含兜底注入）。
- **WCAG AA 对比度修正**：主操作色由 #1a66f5（白字 ≈3.9:1，不达标）调深为 `--brand-600 = hsl(224 76% 48%)`（≈#1d4ed8，白字 ≈6.3:1）；暗色主色改用 --brand-400 亮蓝 + 深色前景。选中 chips、主按钮、视图切换激活态全部受益。
- 字阶收敛为 **12/14/16/18/20/24/30**；间距严格 4pt 网格（44px 移动触控热区单列规范）。

## 2. 真实数据密度（assets/data.js）

- 2026-08-04 从 jobs.zalize.com 公开 API 抓取真实数据：**体制内 20 条 / 校招 18 条 / 编制 18 条**（`window.DATA_POSITIONS/DATA_CAMPUS/DATA_BIANZHI`）。
- `positions.html`（表格+移动卡）、`positions-cards.html`、`campus.html`、`bianzhi.html` 全部改为 **JS 数据渲染**，截止标签（今日截止/N 天后/日期/详见公告）按真实 deadline 计算。

## 3. 完整状态覆盖

- 列表页右下角新增「状态演示」开关，可实机切换 **正常 / 加载骨架 / 空态 / 错误态 / 0 结果导流**（0 结果附放宽建议 + 其他板块结果导流）。首次进入自动演示 600ms 骨架。
- ui.js 组件类全面补齐 **focus-visible ring（2px --ring + offset）与 disabled 态**（btn/chip/input/表格行/导航），表格行支持键盘 Tab + Enter 打开详情、选中行高亮（aria-selected）。
- 每页右上角 🌙 暗色切换（localStorage 记忆）。

## 4. 真 JS 交互（原生 JS）

- **省→市级联多选**（筛选面板）：左省份列表带已选计数、右城市 chips 多选、底部已选城市可单个移除、顶部实时计数。
- **保存筛选命名流**：输入名称 → 保存 → 列表头部插入新条目（高亮边框）→ 可删除。
- **日历月/周/议程切换**：三视图真实切换 + 标题联动 + ‹/› 翻页。
- 详情抽屉 / 筛选抽屉：桌面右侧滑出，**移动端变为带手势把手的底部 Sheet**；Ctrl/Cmd+K 全局搜索、Esc 关闭。

## 5. 三端逐页自测（Playwright，1440 / 768 / 375）

- 11 个页面 × 3 视口共 33 张截图逐页检查，**0 console 错误、0 资源加载失败**；平板 768 看板折叠为横向统计条（非简单堆叠），移动端底部 5 项导航 + 44px 热区。
- 交互冒烟：20 行真实数据渲染 ✓、级联多选（已选 4 城市）✓、保存筛选命名 ✓、详情抽屉 ✓、Ctrl+K ✓、日历周视图 ✓、暗色 ✓。
- 截图存于 `assets/screenshots/r177/`（d1440/t768/m375 前缀 + x- 交互态）。

## 6. tokens.html 升级为完整规范文档页

色板（brand 全阶 + 语义令牌实时渲染）、AA 修正对照、字阶 7 档实例、4pt 间距尺、圆角/阴影/边框、按钮/chips/badge/输入框各状态、骨架、空/错/0 结果三态、抽屉与 Sheet 规范（含可打开的示例抽屉）、布局断点规则。
