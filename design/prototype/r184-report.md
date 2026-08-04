# R184 美工走查报告 —— jobs.zalize.com 渐进改进第二批（2026-08-04）

实测范围：线上 https://jobs.zalize.com ，桌面 1600 / 平板 768 / 移动 375，亮色 + 暗色；覆盖首页三视图（卡片/表格/无限列表）、高级筛选、详情抽屉、Ctrl+K 搜索、日历、今日更新、求职攻略、收藏面板。截图存于 assets/screenshots/r184/（文中引用文件名）。

R181 的 chips 去胶囊化在「筛选预设行」「日历过滤」等处已生效（浅底细边选中态正确），但**主要残留集中在：板块分类 chips、热门搜索、横幅按钮、收藏面板 segmented、卡片视图按钮与彩色标签**。

---

## P1（本批必改：R181 遗漏 / 明显不一致）

### P1-1 板块分类 chips 仍是全套胶囊 + 蓝底白字选中态
- 截图：d1600-home.png（页面中部「全部/公务员/事业编/军队文职/国企央企/选调生…」两行）
- 现状：全部 chips `rounded-full`；选中「全部」为实心蓝底白字胶囊 —— 这正是 R181 要消灭的旧选中态，且它是首屏最显眼的一排控件。
- 改法：`rounded-full` → `rounded-md`；选中态 `bg-primary text-primary-foreground` → `border-primary/60 bg-primary/10 text-primary`；未选中 `border-border bg-background text-muted-foreground hover:bg-muted`。带外链箭头的（校招/免笔试/内推码…）同步处理。

### P1-2 顶部横幅「一键匹配我的条件」实心蓝胶囊按钮
- 截图：d1600-home.png（横幅内）
- 现状：`rounded-full` 实心蓝按钮 + 相邻白色胶囊按钮「看看今天新增」。
- 改法：两个按钮 `rounded-full` → `rounded-lg`；主按钮可保留实心（横幅内唯一主 CTA 合理），次按钮 `border bg-background`。

### P1-3 热门搜索 / 今日速览 全为胶囊
- 截图：d1600-home.png（热门搜索行、今日速览行）
- 现状：`热门搜索` 10 个胶囊 chips；`今日速览` 为实心蓝胶囊标签 + 一排胶囊统计块。
- 改法：统一 `rounded-md`；「今日速览」标签改 `rounded-md bg-primary/10 text-primary`（不用实心蓝）；统计块用 `border border-border rounded-md bg-muted/40`。

### P1-4 收藏面板「提前提醒 3天」= 蓝底白字胶囊选中态残留
- 截图：d1600-favs.png（面板顶部 3天/7天/14天）
- 现状：选中「3天」为实心蓝胶囊，与 R181 规范直接冲突。
- 改法：改成 segmented control：容器 `rounded-lg bg-muted p-0.5`，项 `rounded-md`，选中 `bg-background shadow-xs text-foreground`；或与 chips 一致的浅底细边。

### P1-5 卡片视图每卡一个全宽实心蓝「查看详情」按钮
- 截图：d1600-table.png（实为卡片视图）、m375-table.png（移动）
- 现状：每屏 9+ 个全宽 `bg-primary` 大按钮，视觉权重压过内容本身，是当前页面「显重/显旧」的最大来源。
- 改法：整卡可点击（卡片 `hover:border-primary/40 hover:shadow-sm cursor-pointer`），按钮降级为右下角 ghost：`variant=ghost text-primary h-8 px-2 w-auto`「详情 →」；移动端同样处理，减少 60% 蓝色面积。

### P1-6 表格视图行内彩色实心徽章泛滥（暗色尤重）
- 截图：d1600-tableview.png / d1600-tableview-dark.png
- 现状：每行「2027」实心蓝徽章 +「央企/国企」实心深红徽章，20 行 × 2 个色块；且「考试/招聘类型」列整列都是「企业招聘」纯重复。
- 改法：徽章改中性 `rounded-sm border border-border bg-muted/50 text-muted-foreground`（年份甚至可用纯文本 tabular-nums）；仅「今日截止」保留红色（浅底红字 `bg-destructive/10 text-destructive`）。列重复值时建议列头显示当前筛选、行内省略。

### P1-7 移动端保留桌面「表格视图」偏好导致不可用
- 截图：m375-cards-light.png（实为表格视图状态）
- 现状：桌面切到表格视图后，375px 下仍渲染表格：只剩「单位名（截断）+ 2027 + 央企/国企」三列，标题、地点、截止全部不可见。
- 改法：`< md` 断点强制卡片/列表布局（视图切换仅存桌面偏好），或表格在移动端自动降级为紧凑两行列表。

---

## P2（密度 / 边框阴影收敛）

### P2-1 卡片视图信息密度过低
- 截图：d1600-table.png
- 现状：卡片内边距约 p-5、区块间 space-y-3、网格 gap-6，1600px 首屏仅见 6 卡；badge 换行占两行。
- 改法：`p-5→p-4`、`gap-6→gap-4`、badge 行与标题 `space-y-3→space-y-2`、员工/学历/地点三行 `text-sm leading-6→leading-5`；每屏可多显示约 1 行卡片，不伤可读性。

### P2-2 高级筛选面板与快捷筛选行字段重复 + 控件偏大
- 截图：d1600-filter.png
- 现状：顶部已有 年份/岗位类型/省份/学历 四个下拉，展开高级筛选后又重复出现 年份/岗位类型/学历/考试类型（面板右侧灰字也自述「学历/地区/岗位类型直接用上方筛选，不再单独选」但控件仍在）；下拉高约 h-10，双份占据约 300px 纵向空间。
- 改法：高级面板删去与快捷行重复的 4 个字段，只保留 省/市/区 级联 + 排序 + 保存筛选；控件 `h-10→h-9`，行距 `gap-5→gap-3`。

### P2-3 侧栏数据看板行距可收一档
- 截图：d1600-home.png（右侧）
- 现状：每行约 py-2.5 + 全行分隔线，三组列表纵向很长，「按省份」需长滚动。
- 改法：`py-2.5→py-1.5`，分隔线改 `divide-y divide-border/50` 或去掉仅悬停显示 `hover:bg-muted/50 rounded-sm`。

### P2-4 报名即将截止列表行高偏大 + 红色胶囊
- 截图：d1600-home.png（报名即将截止卡片）
- 现状：每行 py-3 左右；「今日截止」红边胶囊 `rounded-full`。
- 改法：`py-3→py-2`；红标签 `rounded-full→rounded-sm`，保持 `bg-destructive/10 text-destructive border-destructive/30`。

### P2-5 今日更新页日期/板块 chips 为描边胶囊，且与卡片圆角混用
- 截图：d1600-updates-retry.png
- 现状：两行 chips 全 `rounded-full`（选中为蓝描边浅底胶囊——底色对了、形状还是胶囊）；下方分组卡片 `rounded-xl`，行内「秋招/实习」小标签又是第三种圆角。
- 改法：chips `rounded-full→rounded-md`；行尾类型小标签统一 `rounded-sm border-border text-muted-foreground`；圆角层级遵守 R178 规范（控件 6-8px / 卡片 12px）。

---

## P3（字阶层级 / 细节打磨）

### P3-1 卡片标题与单位名对比可再拉开
- 截图：d1600-table.png
- 现状：标题 ~17px/600，单位/学历/地点三行同为 14px 灰色且带同权重图标，扫读时三行地位相同。
- 改法：标题 `font-semibold tracking-tight`；单位保留 14px，学历+地点合并为一行 `text-xs text-muted-foreground`（省一行、层级更清楚）。

### P3-2 表格视图列优先级：单位列在前、标题被截断
- 截图：d1600-tableview.png
- 现状：第一列是单位名，岗位标题在第 5 列且窄到截断——用户扫读主键是岗位名。
- 改法：岗位标题列提前至第一列并给 `min-w-[240px]`，单位名次之 `text-muted-foreground`。

### P3-3 详情抽屉节奏良好，仅需统一标签形状
- 截图：d1600-drawer2.png
- 现状：抽屉标题区 badge（2027/其他企业/硕士研究生/不限专业）仍为胶囊；「未投递」下拉为蓝色胶囊；内容区排版与分区清晰，无需动。
- 改法：badge `rounded-full→rounded-sm`；「未投递」状态钮 `rounded-md border bg-primary/10 text-primary`。

### P3-4 日历页每日计数徽章为彩色小胶囊
- 截图：d1600-calendar.png
- 现状：日期格内 蓝/紫 实心小胶囊计数；顶部过滤 chips 胶囊（选中态颜色已对）。
- 改法：计数徽章 `rounded-full→rounded-sm`，改浅底 `bg-primary/10 text-primary`、`bg-purple-500/10 text-purple-600`；今天日期实心圆可保留（属允许的圆形状态点）。

### P3-5 求职攻略抽屉话题 chips 胶囊
- 截图：d1600-guide.png
- 改法：同 P1-1 的 chips 规则（`rounded-md` + 浅底细边选中）。

### P3-6 暗色模式整体过关，唯彩色实心徽章更刺眼
- 截图：d1600-tableview-dark.png、d1600-drawer2-dark.png
- 说明：暗色下背景/边框/文字层级正确；P1-6 改中性徽章后暗色问题随之消失，无需单独暗色适配。

---

## 汇总

| 级别 | 条数 | 主题 |
|---|---|---|
| P1 | 7 | 胶囊/蓝底白字残留（板块 chips、横幅、热门搜索、收藏 segmented）、卡片大蓝按钮、彩色徽章、移动表格视图不可用 |
| P2 | 5 | 卡片/筛选/侧栏/截止列表/更新页 密度与圆角层级收敛 |
| P3 | 6 | 字阶层级、表格列序、抽屉与日历标签形状统一 |

统一原则（第二批执行基线）：chips/标签一律 `rounded-md`（小标签 `rounded-sm`），选中态一律 `border-primary/60 bg-primary/10 text-primary`；实心 primary 仅保留每屏 ≤1 个主 CTA；彩色徽章仅保留「今日截止」红与状态语义色，其余转中性；`rounded-full` 仅头像/开关/圆形图标钮/状态点。
