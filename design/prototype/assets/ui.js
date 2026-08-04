/* 上岸罗盘 · R176 原型共享 UI（顶栏 / 底部导航 / 全局搜索 / 主题切换 / 组件样式） */
(function () {
  const CSS = `
:root { color-scheme: light; } .dark { color-scheme: dark; }
html { -webkit-font-smoothing: antialiased; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif; font-size: 14px; }
.s-page   { @apply bg-surface-page dark:bg-surface-page-d; }
.s-card   { @apply bg-surface-card dark:bg-surface-card-d border border-line dark:border-line-d rounded-lg2 shadow-card dark:shadow-card-d; }
.t1 { @apply text-ink-1 dark:text-ink-1d; } .t2 { @apply text-ink-2 dark:text-ink-2d; } .t3 { @apply text-ink-3 dark:text-ink-3d; }
.btn      { @apply inline-flex items-center justify-center gap-1.5 rounded-md2 px-3 h-9 text-body font-medium cursor-pointer select-none transition-colors whitespace-nowrap; }
.btn-pri  { @apply btn bg-brand-600 text-white hover:bg-brand-700 shadow-card; }
.btn-sec  { @apply btn border border-line dark:border-line-d t1 bg-surface-card dark:bg-surface-card-d hover:bg-surface-sunken dark:hover:bg-surface-sunken-d; }
.btn-ghost{ @apply btn t2 hover:bg-surface-sunken dark:hover:bg-surface-sunken-d; }
.btn-sm   { @apply h-8 px-2.5 text-xs1; }
.chip        { @apply inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs1 border border-line dark:border-line-d t2 cursor-pointer hover:border-brand-400 hover:text-brand-600 transition-colors whitespace-nowrap; }
.chip-on     { @apply chip bg-brand-600 border-brand-600 text-white hover:text-white; }
.tag         { @apply inline-flex items-center h-5 px-1.5 rounded-sm2 text-xs2 font-medium whitespace-nowrap; }
.tag-blue    { @apply tag bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300; }
.tag-teal    { @apply tag bg-teal-50 text-teal-700 dark:bg-teal-900/60 dark:text-teal-300; }
.tag-purple  { @apply tag bg-violet-50 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300; }
.tag-red     { @apply tag bg-rose-50 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300; }
.tag-amber   { @apply tag bg-amber-50 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300; }
.tag-green   { @apply tag bg-emerald-50 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300; }
.tag-gray    { @apply tag bg-surface-sunken text-ink-2 dark:bg-surface-sunken-d dark:text-ink-2d; }
.input { @apply h-9 w-full rounded-md2 border border-line dark:border-line-d bg-surface-card dark:bg-surface-card-d px-3 text-body t1 placeholder:text-ink-3 dark:placeholder:text-ink-3d focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500; }
.tbl th { @apply text-left text-xs1 font-medium t3 px-3 py-2.5 border-b border-line dark:border-line-d whitespace-nowrap bg-surface-sunken/60 dark:bg-surface-sunken-d/60; }
.tbl td { @apply px-3 py-3 text-body t1 border-b border-line/70 dark:border-line-d/70 align-top; }
.tbl tbody tr { @apply hover:bg-brand-50/50 dark:hover:bg-brand-950/30 cursor-pointer transition-colors; }
.overlay-mask { @apply fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-[2px] z-40; }
.drawer  { @apply fixed z-50 bg-surface-card dark:bg-surface-card-d shadow-overlay right-0 top-0 h-full w-full sm:w-[540px] overflow-y-auto; }
.sheet-m { @apply fixed z-50 bg-surface-card dark:bg-surface-card-d shadow-overlay inset-x-0 bottom-0 rounded-t-xl2 max-h-[86vh] overflow-y-auto; }
.hide-scroll::-webkit-scrollbar { display:none; } .hide-scroll { scrollbar-width:none; }
.navlink { @apply inline-flex items-center gap-1 h-9 px-3 rounded-md2 text-body t2 hover:bg-surface-sunken dark:hover:bg-surface-sunken-d transition-colors; }
.navlink-on { @apply navlink bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-medium; }
`;
  const style = document.createElement('style');
  style.type = 'text/tailwindcss';
  style.textContent = CSS;
  document.head.appendChild(style);

  // 主题
  const saved = localStorage.getItem('proto-theme');
  if (saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.classList.add('dark');
  window.toggleTheme = function () {
    const el = document.documentElement;
    el.classList.toggle('dark');
    localStorage.setItem('proto-theme', el.classList.contains('dark') ? 'dark' : 'light');
  };

  const LOGO = `<a href="index.html" class="flex items-center gap-2 shrink-0">
    <span class="w-8 h-8 rounded-md2 bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-card">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 3 3 11l6 2.5L11.5 20 21 3Z" fill="#fff"/></svg>
    </span>
    <span class="text-md1 font-semibold t1 tracking-tight">上岸罗盘</span>
  </a>`;

  const NAV = [
    ['positions.html', '体制内', 'positions'],
    ['campus.html', '校招', 'campus'],
    ['bianzhi.html', '编制', 'bianzhi'],
    ['calendar.html', '日历', 'calendar'],
    ['updates.html', '今日更新', 'updates'],
    ['guide.html', '攻略', 'guide'],
  ];

  window.renderHeader = function (active) {
    const links = NAV.map(([href, label, key]) =>
      `<a href="${href}" class="${key === active ? 'navlink-on' : 'navlink'}">${label}</a>`).join('');
    return `
<header class="sticky top-0 z-30 border-b border-line dark:border-line-d bg-surface-card/85 dark:bg-surface-card-d/85 backdrop-blur">
  <div class="max-w-[1280px] mx-auto px-4 h-14 flex items-center gap-3">
    ${LOGO}
    <nav class="hidden md:flex items-center gap-0.5 ml-4">${links}</nav>
    <div class="flex-1"></div>
    <button onclick="openSearch()" class="hidden sm:flex items-center gap-2 h-9 w-56 lg:w-64 px-3 rounded-md2 border border-line dark:border-line-d text-xs1 t3 hover:border-brand-400 transition-colors">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      搜索岗位 / 单位 / 专业
      <kbd class="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-line dark:border-line-d">Ctrl K</kbd>
    </button>
    <button onclick="openSearch()" class="sm:hidden btn-ghost !h-9 !w-9 !px-0" aria-label="搜索">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
    </button>
    <button onclick="toggleTheme()" class="btn-ghost !h-9 !w-9 !px-0" aria-label="主题">
      <svg class="dark:hidden" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      <svg class="hidden dark:block" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
    </button>
    <a href="favorites.html" class="btn-sec !h-9 max-sm:!hidden">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 17.3-5.4 3 1-6-4.4-4.2 6-.9L12 3.7l2.8 5.5 6 .9-4.4 4.2 1 6z"/></svg>
      收藏 <span class="tag-blue !h-4 px-1">6</span>
    </a>
  </div>
</header>`;
  };

  window.renderBottomNav = function (active) {
    const items = [
      ['positions.html', 'jobs', '岗位', 'M4 7h16M4 7v12h16V7M4 7l2-4h12l2 4M9 11h6'],
      ['calendar.html', 'calendar', '日历', 'M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z'],
      ['search-results.html', 'search', '搜索', 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm10 17-4.3-4.3'],
      ['favorites.html', 'fav', '收藏', 'm12 17.3-5.4 3 1-6-4.4-4.2 6-.9L12 3.7l2.8 5.5 6 .9-4.4 4.2 1 6z'],
      ['guide.html', 'guide', '攻略', 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z'],
    ];
    return `
<nav class="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line dark:border-line-d bg-surface-card/95 dark:bg-surface-card-d/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
  <div class="grid grid-cols-5 h-14">
    ${items.map(([href, key, label, d]) => `
    <a href="${href}" class="flex flex-col items-center justify-center gap-0.5 ${key === active ? 'text-brand-600 dark:text-brand-400' : 'text-ink-3 dark:text-ink-3d'}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="${d}"/></svg>
      <span class="text-[10px] leading-none ${key === active ? 'font-medium' : ''}">${label}</span>
    </a>`).join('')}
  </div>
</nav>
<div class="md:hidden h-16"></div>`;
  };

  // 全局搜索弹层
  window.openSearch = function () {
    document.getElementById('proto-search')?.classList.remove('hidden');
    document.getElementById('proto-search-input')?.focus();
  };
  window.closeSearch = function () {
    document.getElementById('proto-search')?.classList.add('hidden');
  };
  window.renderSearchOverlay = function () {
    return `
<div id="proto-search" class="hidden">
  <div class="overlay-mask" onclick="closeSearch()"></div>
  <div class="fixed z-50 inset-x-3 top-16 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[640px] s-card !rounded-lg2 overflow-hidden">
    <div class="flex items-center gap-2 px-4 h-12 border-b border-line dark:border-line-d">
      <svg class="t3" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="proto-search-input" class="flex-1 bg-transparent outline-none text-body t1 placeholder:text-ink-3" placeholder="搜索岗位 / 单位 / 专业（同时搜三板块）"/>
      <kbd class="text-[10px] px-1.5 py-0.5 rounded border border-line dark:border-line-d t3">Esc</kbd>
    </div>
    <div class="p-4 space-y-4">
      <div>
        <div class="text-xs2 t3 mb-2">热门搜索</div>
        <div class="flex flex-wrap gap-1.5">
          ${['教师', '计算机', '北京', '上海', '法学', '会计', '国考', '央企校招'].map(k => `<a href="search-results.html" class="chip">${k}</a>`).join('')}
        </div>
      </div>
      <div>
        <div class="text-xs2 t3 mb-2">最近搜索</div>
        <div class="space-y-1">
          <a href="search-results.html" class="flex items-center gap-2 h-9 px-2 rounded-md2 hover:bg-surface-sunken dark:hover:bg-surface-sunken-d t1 text-body"><svg class="t3" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>教师 · 三板块 17,103 条<span class="ml-auto text-xs2 t3">昨天</span></a>
          <a href="search-results.html" class="flex items-center gap-2 h-9 px-2 rounded-md2 hover:bg-surface-sunken dark:hover:bg-surface-sunken-d t1 text-body"><svg class="t3" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>水利水电 湖南<span class="ml-auto text-xs2 t3">3 天前</span></a>
        </div>
      </div>
      <div>
        <div class="text-xs2 t3 mb-2">直达</div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <a href="calendar.html" class="btn-sec btn-sm justify-start">📅 报考日历</a>
          <a href="updates.html" class="btn-sec btn-sm justify-start">✨ 今日更新</a>
          <a href="favorites.html" class="btn-sec btn-sm justify-start">⭐ 我的收藏</a>
          <a href="guide.html" class="btn-sec btn-sm justify-start">📖 求职攻略</a>
        </div>
      </div>
    </div>
  </div>
</div>`;
  };

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
    if (e.key === 'Escape') closeSearch();
  });

  // 通用抽屉开关
  window.openEl = (id) => document.getElementById(id)?.classList.remove('hidden');
  window.closeEl = (id) => document.getElementById(id)?.classList.add('hidden');

  window.mountChrome = function () {
    const body = document.body;
    const page = body.dataset.page || '';
    const mobileActive = body.dataset.mobile || 'jobs';
    body.insertAdjacentHTML('afterbegin', renderHeader(page));
    body.insertAdjacentHTML('beforeend', renderBottomNav(mobileActive));
    body.insertAdjacentHTML('beforeend', renderSearchOverlay());
  };
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.chrome !== 'off') mountChrome();
  });
})();
