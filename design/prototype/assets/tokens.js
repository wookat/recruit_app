/* R177：Tailwind 别名映射 —— 唯一色值来源是 assets/tokens.css 的 CSS variables。
   亮/暗色由 CSS 变量自动切换，因此 xxx 与 xxx-d 别名指向同一变量（保留 R176 类名兼容）。 */
const v = (name) => `hsl(var(--${name}) / <alpha-value>)`;

tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: v('brand-50'), 100: v('brand-100'), 200: v('brand-200'),
          300: v('brand-300'), 400: v('brand-400'), 500: v('brand-500'),
          600: v('brand-600'), 700: v('brand-700'), 800: v('brand-800'),
          900: v('brand-900'), 950: v('brand-950'),
        },
        // shadcn 语义令牌
        background: v('background'), foreground: v('foreground'),
        card: v('card'), 'card-foreground': v('card-foreground'),
        popover: v('popover'), 'popover-foreground': v('popover-foreground'),
        primary: v('primary'), 'primary-foreground': v('primary-foreground'),
        secondary: v('secondary'), 'secondary-foreground': v('secondary-foreground'),
        muted: v('muted'), 'muted-foreground': v('muted-foreground'),
        accent: v('accent'), 'accent-foreground': v('accent-foreground'),
        destructive: v('destructive'), 'destructive-foreground': v('destructive-foreground'),
        border: v('border'), input: v('input'), ring: v('ring'),
        // R176 兼容别名（亮暗同变量，dark: 前缀类无害）
        surface: {
          page: v('background'), card: v('card'), raised: v('popover'), sunken: v('muted'),
          'page-d': v('background'), 'card-d': v('card'), 'raised-d': v('popover'), 'sunken-d': v('muted'),
        },
        ink: {
          1: v('foreground'), 2: v('muted-foreground'), 3: v('subtle-foreground'),
          '1d': v('foreground'), '2d': v('muted-foreground'), '3d': v('subtle-foreground'),
        },
        line: { DEFAULT: v('border'), d: v('border') },
        tizhi: v('board-tizhi'),
        campus: v('board-campus'),
        bianzhi: v('board-bianzhi'),
        danger: v('danger'),
        warn: v('warn'),
        ok: v('ok'),
      },
      /* 字阶：12 / 14 / 16 / 18 / 20 / 24 / 30 */
      fontSize: {
        'xs2': ['12px', '16px'],
        'xs1': ['12px', '18px'],
        'body': ['14px', '22px'],
        'md1': ['16px', '24px'],
        'lg1': ['18px', '26px'],
        'xl1': ['20px', '28px'],
        'xxl': ['24px', '32px'],
        'xxxl': ['30px', '38px'],
      },
      borderRadius: {
        'sm2': 'var(--radius-sm)',
        'md2': 'var(--radius)',
        'lg2': 'var(--radius-lg)',
        'xl2': 'var(--radius-xl)',
      },
      boxShadow: {
        'card': 'var(--shadow-card)',
        'raised': 'var(--shadow-raised)',
        'overlay': 'var(--shadow-overlay)',
        'card-d': 'var(--shadow-card)',
      },
      spacing: { '4.5': '18px', '11': '44px' },
    },
  },
};
