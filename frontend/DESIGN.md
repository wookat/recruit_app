# 前端设计规范（Design System）

> 适用范围：`frontend/` 全部界面。技术体系：Tailwind CSS v4 + shadcn/ui（Base UI），token 定义于 `src/index.css`。
> 原则：中性灰阶打底 + 品牌蓝主色（呼应「上岸雷达」Logo 蓝青渐变）、语义色只用于状态表达、4px 栅格、亮暗双模式一致可读。

---

## 1. 色彩系统

### 1.1 语义 token（与 `src/index.css` 中 CSS 变量一一对应）

| 语义 | CSS 变量 | 亮色值 | 暗色值（`.dark`） | 用途 |
|---|---|---|---|---|
| 背景 | `--background` | `oklch(1 0 0)` | `oklch(0.145 0 0)` | 页面底色 |
| 前景 | `--foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | 正文文字 |
| 卡片 | `--card` / `--card-foreground` | 白 / 近黑 | `oklch(0.205 0 0)` / 近白 | Card 容器 |
| 浮层 | `--popover` / `--popover-foreground` | 白 / 近黑 | `oklch(0.205 0 0)` / 近白 | Dropdown/Sheet/Dialog |
| 主色 | `--primary` / `--primary-foreground` | `oklch(0.546 0.215 258)`（品牌蓝）/ 近白 | `oklch(0.707 0.155 254)`（提亮蓝）/ 近黑 | 主按钮、选中态、链接 |
| 次级 | `--secondary` / `--secondary-foreground` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` | 次级按钮、secondary 徽章 |
| 弱化 | `--muted` / `--muted-foreground` | `oklch(0.97 0 0)` / `oklch(0.556 0 0)` | `oklch(0.269 0 0)` / `oklch(0.708 0 0)` | 弱化底、辅助文字 |
| 危险 | `--destructive` | `oklch(0.577 0.245 27)` | `oklch(0.704 0.191 22)` | 删除、失败 |
| 边框 | `--border` / `--input` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%–15%)` | 分隔线、输入框描边 |
| 焦点环 | `--ring` | `oklch(0.623 0.188 258)` | `oklch(0.623 0.188 258)` | focus-visible 环 |

主色为**品牌蓝**（色相 ~254–258°，与 Logo 蓝青渐变 `#2563EB → #0891B2` 协调）：亮色模式取深蓝，对白色文字对比度 ≥4.5:1；暗色模式提亮并配近黑前景，避免刺眼。`--ring` 与 `--sidebar-primary` / `--sidebar-ring` 同步为品牌蓝。除 primary/ring 外的语义色（红/黄/绿/sky 提示条等）保持不变，彩色状态仅用于下表语义。

### 1.2 状态色（Tailwind 调色板，亮暗成对使用）

统一模式：亮色 `bg-{c}-100 text-{c}-700`，暗色 `dark:bg-{c}-950 dark:text-{c}-300`（中性灰用 `slate-100/600` 与 `dark:slate-800/300`）。

| 状态语义 | 色相 | 代码出处 |
|---|---|---|
| success（成功 / OC 录用 / 采集成功） | `green` | `STATUS_COLORS`（`src/lib/positionStore.ts`）、`RUN_STATUS_STYLES`（AdminPage） |
| warning（部分成功 / 已放弃 / 常规截止） | `amber` / `yellow` | 同上、截止徽章 |
| danger（失败 / 已挂 / ≤1 天截止） | `red` | 同上 |
| info（已投递） | `blue` | `STATUS_COLORS` |
| 进行中（待笔试 / 待面试） | `cyan` / `violet` | `STATUS_COLORS` |
| 中性（未投递 / 运行中 / 已过期） | `slate` | `STATUS_COLORS`、`RUN_STATUS_STYLES` |

截止紧迫度阶梯：`red`（≤1 天）→ `orange`（≤3 天）→ `amber`（其余）→ `slate`（已过期，容器再叠 `opacity-50`）。

**禁止**：新增无 `dark:` 变体的硬编码色；用状态色做装饰性用途。

### 1.3 分类色板（多维表格风格标签）

分类字段（岗位类型 / 年份 / 学历 / 省份 / 投递渠道）使用柔和底色 + 深色文字的彩色标签，统一维护在 `src/lib/badgeColors.ts`：

- 统一类名模式：`bg-{c}-100 text-{c}-700 dark:bg-{c}-950 dark:text-{c}-300`（中性 `slate` 例外，沿用 `STATUS_COLORS.未投递` 的写法），全部收敛在 `TONE_CLASSES`。
- 胶囊形态统一用 `PILL_BASE`（`rounded-full px-2 py-0.5 text-[11px] font-medium`），与投递状态 pill 一致。

| 字段 | 映射 | 兜底 |
|---|---|---|
| job_type | 公务员=blue、事业单位/事业编=violet、军队文职=green、央企/国企=red、选调生=orange、三支一扶=cyan、教师=pink、银行=indigo、上市公司=teal、其他企业=slate | `hashTone`（固定 hash，排除 red/slate 语义色） |
| year | ≥2027=red（高亮最新）、2026=orange、2025=green、更早=slate | — |
| edu_level_norm | 大专/中专=teal、本科=blue、硕士=violet、博士=purple、其他/不限=slate | `hashTone` |
| province / 工作地点 | 按前 3 字 `hashTone` 淡色底（同省稳定同色） | slate |
| 投递渠道 | 官网=blue、内推=green、邮箱=orange、招聘平台=cyan、现场招聘=violet、其他=slate | — |

**约束**：新增分类标签必须复用 `TONE_CLASSES` + `PILL_BASE`，不得内联新的色值组合；未知枚举值一律走 `hashTone` 兜底，禁止 hardcode 单个值的颜色到组件里。

---

## 2. 字体层级

字族：`--font-sans: 'Geist Variable', sans-serif`（`@fontsource-variable/geist`），中文回退系统字体。全局 `antialiased`。

| 层级 | 类 | 尺寸/行高 | 字重 | 用途 |
|---|---|---|---|---|
| 页面标题 | `text-xl font-bold tracking-tight` | 20/28 | 700 | 「岗位检索」等 H1 |
| 区块/弹层标题 | `text-lg font-bold` 或 `SheetTitle` | 18/28 | 600–700 | Sheet/Dialog 标题 |
| 卡片标题 | `text-base font-semibold leading-snug` | 16/1.375 | 600 | 岗位名 |
| 正文 | `text-sm` | 14/20 | 400 | 表格、表单、列表 |
| 辅助 | `text-xs text-muted-foreground` | 12/16 | 400 | meta 信息、提示 |
| 微标签 | `text-[11px] font-medium` | 11 | 500 | 状态 pill、计数徽章 |

数字列（计数、页码）使用 `tabular-nums`。

---

## 3. 间距节奏（4px 基准）

只使用 4px 倍数：`gap-1(4) / gap-1.5(6，图标与文字) / gap-2(8) / gap-3(12) / gap-4(16) / gap-6(24)`。

| 场景 | 规范 |
|---|---|
| 页面容器 | `max-w-7xl px-4`，区块间 `space-y-*`（页面主轴 `py-6`） |
| 卡片内边距 | `p-4`（紧凑列表行 `px-4 py-3`，桌面 Sheet `px-6`） |
| 表单控件间 | `gap-2`，分组间 `space-y-4` |
| 图标与文字 | `gap-1.5`（按钮内）/ `gap-2`（标题行） |

---

## 4. 圆角与阴影层级

圆角基准 `--radius: 0.625rem`（10px），派生 token 见 `index.css` `@theme`：`--radius-sm`(6) `--radius-md`(8) `--radius-lg`(10) `--radius-xl`(14) `--radius-2xl`(18) `--radius-4xl`(26)。

| 元素 | 圆角 | 阴影 |
|---|---|---|
| 按钮 / 输入 / Select / 浮层菜单 | `rounded-lg` | 菜单 `shadow-md ring-1 ring-foreground/10` |
| 卡片 / 大容器 / 表格外框 | `rounded-xl` | 静态 `shadow-sm`，hover `shadow-md` |
| 徽章 Badge | `rounded-4xl`（胶囊） | 无 |
| 状态 pill / 计数点 | `rounded-full` | 无 |
| 底部 Sheet | `rounded-t-2xl` | `shadow-lg` |
| Toast / 全局浮动提示 | `rounded-lg` | `shadow-lg` |

阴影只有三档：`shadow-sm`（静态容器）→ `shadow-md`（hover / 浮层菜单）→ `shadow-lg`（Sheet/Dialog/Toast）。禁止 `shadow-xl` 及自定义阴影。

---

## 5. 组件规范

### 5.1 按钮（`src/components/ui/button.tsx`）

尺寸矩阵（桌面）：

| size | 高度 | 用途 |
|---|---|---|
| `xs` | 24px | 表格行内操作 |
| `sm` | 28px | 工具栏、次级操作 |
| `default` | 32px | 常规 |
| `lg` / 自定 `h-9` | 36px | 主操作、筛选行 |
| `icon` 系列 | 24/28/32/36px 方形 | 图标按钮 |

移动端触控目标 ≥44px：交互热点在 `sm` 断点以下用 `h-11`（或 `h-11 w-11`）覆写，`sm:` 起恢复紧凑尺寸（示例见 `FavoriteButton` / `CompareButton` / ListPage 视图切换）。

状态矩阵（所有 variant 必须齐备）：default → `hover:bg-*/80 或 hover:bg-muted` → `active:translate-y-px`（按压下沉）→ `focus-visible:ring-3 ring-ring/50` → `disabled:opacity-50`。

### 5.2 徽章（`src/components/ui/badge.tsx`）

高度 20px、`rounded-4xl`、`text-xs font-medium`。variant 语义：`secondary`＝中性信息（年份、计数）、`outline`＝弱分类（岗位类型、学历）、`destructive`＝危险。彩色状态一律走 §1.2 状态色 pill（`rounded-full px-2 py-0.5 text-[11px] font-medium`），不要给 Badge 直接叠彩色底。

### 5.3 卡片

`rounded-xl border bg-card shadow-sm`；可交互卡片：`transition-all hover:border-primary/20 hover:shadow-md`。内容层级：徽章行 → 标题（`text-base font-semibold`）→ meta（`text-sm text-muted-foreground` + 16px 图标）→ 底部主操作按钮。

### 5.4 表单

输入/Select 高度 32px（`h-8`/`data-[size=default]:h-8`），关键筛选行 36px（`h-9`）；焦点统一 `focus-visible:border-ring ring-3 ring-ring/50`；错误态 `aria-invalid:border-destructive`。

### 5.5 弹层

| 组件 | 结构 |
|---|---|
| DropdownMenu / Select 菜单 | `rounded-lg bg-popover shadow-md ring-1 ring-foreground/10` |
| Dialog | 居中，`rounded-xl ring-1 ring-foreground/10`，遮罩 `bg-black/10 + backdrop-blur-xs` |
| Sheet（右侧） | 全高 `max-w-sm`，头部 `px-4 sm:px-6 pt-6`，正文滚动区独立 |
| Sheet（底部，移动筛选） | `rounded-t-2xl max-h-[85dvh]`，底部 sticky 主按钮 |
| 空态 | `EmptyState` 组件：虚线边框 + 圆形图标底 + 主/副文案 + 可选 action |
| 加载 | 结构化 Skeleton（模拟真实布局），禁止整块灰矩形 |

### 5.6 动效规范

| 场景 | 时长 | 缓动 |
|---|---|---|
| 颜色/hover 反馈 | 150ms（Tailwind 默认） | ease |
| 遮罩淡入淡出 | 150ms | ease |
| 浮层菜单（scale+fade） | 100ms | ease-out |
| Sheet 滑入滑出 | 200ms | ease-in-out |
| 列表项进入渐现 | 350ms，逐项延迟 30ms（上限 240ms） | ease-out（`animate-fade-in-up`） |
| 页面/标签切换 | 350ms fade-up | ease-out |

动效只用 CSS transition/animation，不引入 JS 动画库；须尊重 `prefers-reduced-motion: reduce`（`index.css` 已对 `animate-fade-in-up` 关闭动画）。

---

## 6. 可访问性底线

- 移动端（<640px）触控目标 ≥44×44px。
- 图标按钮必须有 `aria-label`。
- 文字对比度 ≥ 4.5:1（状态色按 §1.2 亮暗成对模式即满足）。
- 焦点可见：一律 `focus-visible:ring-3 ring-ring/50`，禁止 `outline-none` 裸用。
