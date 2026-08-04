/* 上岸罗盘 · R178 原型共享 UI（组件库现代化：圆角分层、去胶囊化 chips、hairline+阴影收敛、密度收紧）
   （顶栏 / 底部导航 / 全局搜索 / 主题切换 / 组件样式 / 状态演示 / 通用交互）
   色值唯一来源：assets/tokens.css —— 本文件只组合令牌，不写死颜色。 */
(function () {
  // 确保统一引用同一份 tokens.css
  if (!document.querySelector('link[href$="tokens.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'assets/tokens.css';
    document.head.prepend(l);
  }

  const CSS = `
.s-page   { @apply bg-background; }
.s-card   { @apply bg-card border border-border rounded-lg2 shadow-card; }
.t1 { @apply text-foreground; } .t2 { @apply text-muted-foreground; } .t3 { @apply text-muted-foreground; }

/* 按钮（rounded-md 8px）：默认/悬停/按下/focus ring/禁用 完整状态 */
.btn      { @apply inline-flex items-center justify-center gap-1.5 rounded-md2 px-3 h-8 text-body font-medium cursor-pointer select-none transition-colors whitespace-nowrap
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
            disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed; }
.btn-pri  { @apply btn bg-primary text-primary-foreground hover:bg-brand-700 dark:hover:bg-brand-300 active:bg-brand-800 shadow-card; }
.btn-sec  { @apply btn border border-border t1 bg-card hover:bg-muted active:bg-secondary shadow-card; }
.btn-ghost{ @apply btn t2 hover:bg-muted hover:text-foreground active:bg-secondary; }
.btn-sm   { @apply h-7 px-2 text-xs1 rounded-ctl; }
.btn-danger { @apply btn bg-destructive text-destructive-foreground hover:opacity-90; }

/* 筛选 chips（R178 去胶囊化：rounded 6px 方角轻量 tag）：
   默认 = 细 1px 中性边框 + 中性底；选中 = 细主色边框 + 主色浅底(primary/10) + 主色文字（brand-700 白底 6.8:1 ≥ AA） */
.chip        { @apply inline-flex items-center gap-1 h-6 px-2 rounded-ctl text-xs1 border border-border bg-card t2 cursor-pointer
               hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors whitespace-nowrap
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background
               disabled:opacity-50 disabled:pointer-events-none; }
.chip-on     { @apply chip border-brand-600 bg-primary/10 text-brand-700 font-medium hover:text-brand-700
               dark:border-brand-400 dark:bg-brand-400/15 dark:text-brand-300 dark:hover:text-brand-300; }
/* segmented control（视图切换/日历切换用） */
.seg      { @apply inline-flex items-center gap-0.5 p-0.5 rounded-md2 border border-border bg-muted; }
.seg-item { @apply h-7 px-2.5 rounded-ctl text-xs1 t2 cursor-pointer transition-colors hover:text-foreground whitespace-nowrap
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring; }
.seg-on   { @apply seg-item bg-card text-foreground font-medium shadow-card; }

/* 状态标签 */
.tag         { @apply inline-flex items-center h-5 px-1.5 rounded-sm2 text-xs2 font-medium whitespace-nowrap; }
.count-badge { @apply inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-sm2 text-xs2 font-medium bg-primary/10 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300; }
.tag-blue    { @apply tag bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300; }
.tag-teal    { @apply tag bg-teal-50 text-teal-800 dark:bg-teal-900/60 dark:text-teal-300; }
.tag-purple  { @apply tag bg-violet-50 text-violet-800 dark:bg-violet-900/60 dark:text-violet-300; }
.tag-red     { @apply tag bg-rose-50 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300; }
.tag-amber   { @apply tag bg-amber-50 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300; }
.tag-green   { @apply tag bg-emerald-50 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300; }
.tag-gray    { @apply tag bg-muted text-muted-foreground; }

/* 输入：focus ring + 禁用 */
.input { @apply h-8 w-full rounded-md2 border border-input bg-card px-2.5 text-body t1 placeholder:text-muted-foreground/70 transition-shadow
         focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-brand-500
         disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-muted; }

.tbl th { @apply text-left text-xs1 font-medium t3 px-3 py-2 border-b border-border whitespace-nowrap bg-muted/60; }
.tbl td { @apply px-3 py-2.5 text-body t1 border-b border-border/70 align-top; }
.tbl tbody tr { @apply hover:bg-brand-50/60 dark:hover:bg-brand-950/40 cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-brand-50 dark:focus-visible:bg-brand-950; }
.tbl tbody tr[aria-selected="true"] { @apply bg-brand-50 dark:bg-brand-950/60; }

.overlay-mask { @apply fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-[2px] z-40; }
.drawer  { @apply fixed z-50 bg-card shadow-overlay right-0 top-0 h-full w-full sm:w-[540px] overflow-y-auto; }
.sheet-m { @apply fixed z-50 bg-card shadow-overlay inset-x-0 bottom-0 rounded-t-xl2 max-h-[86vh] overflow-y-auto; }
.hide-scroll::-webkit-scrollbar { display:none; } .hide-scroll { scrollbar-width:none; }
.navlink { @apply inline-flex items-center gap-1 h-8 px-2.5 rounded-ctl text-body t2 whitespace-nowrap hover:bg-muted transition-colors
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring; }
.navlink-on { @apply navlink bg-accent text-accent-foreground font-medium; }
/* 移动端触控热区 ≥44px */
.tap44 { @apply max-sm:min-h-[44px] max-sm:min-w-[44px]; }
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

  const LOGO = `<a href="index.html" class="flex items-center gap-2 shrink-0 rounded-md2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
      `<a href="${href}" class="${key === active ? 'navlink-on' : 'navlink'}" ${key === active ? 'aria-current="page"' : ''}>${label}</a>`).join('');
    return `
<header class="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur">
  <div class="max-w-[1280px] mx-auto px-4 h-14 flex items-center gap-3">
    ${LOGO}
    <nav class="hidden md:flex items-center gap-0.5 ml-4">${links}</nav>
    <div class="flex-1"></div>
    <button onclick="openSearch()" class="hidden lg:flex items-center gap-2 h-9 w-56 xl:w-64 px-3 rounded-md2 border border-border text-xs1 t3 hover:border-brand-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      搜索岗位 / 单位 / 专业
      <kbd class="ml-auto text-[10px] px-1.5 py-0.5 rounded-sm2 border border-border">Ctrl K</kbd>
    </button>
    <button onclick="openSearch()" class="lg:hidden btn-ghost !h-9 !w-9 max-sm:!h-11 max-sm:!w-11 !px-0" aria-label="搜索">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
    </button>
    <button onclick="toggleTheme()" class="btn-ghost !h-9 !w-9 max-sm:!h-11 max-sm:!w-11 !px-0" aria-label="切换主题">
      <svg class="dark:hidden" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      <svg class="hidden dark:block" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
    </button>
    <a href="favorites.html" class="btn-sec !h-9 max-sm:!hidden">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 17.3-5.4 3 1-6-4.4-4.2 6-.9L12 3.7l2.8 5.5 6 .9-4.4 4.2 1 6z"/></svg>
      收藏 <span class="count-badge">6</span>
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
<nav class="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
  <div class="grid grid-cols-5 h-14">
    ${items.map(([href, key, label, d]) => `
    <a href="${href}" class="flex flex-col items-center justify-center gap-0.5 min-h-[44px] ${key === active ? 'text-brand-600 dark:text-brand-400' : 'text-muted-foreground'}" ${key === active ? 'aria-current="page"' : ''}>
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
  <div class="fixed z-50 inset-x-3 top-16 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[640px] s-card !rounded-lg2 overflow-hidden" role="dialog" aria-label="全局搜索">
    <div class="flex items-center gap-2 px-4 h-12 border-b border-border">
      <svg class="t3" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="proto-search-input" class="flex-1 bg-transparent outline-none text-body t1 placeholder:text-muted-foreground/70"
        placeholder="搜索岗位 / 单位 / 专业（同时搜三板块）"
        onkeydown="if(event.key==='Enter'&&this.value.trim())location.href='search-results.html'"/>
      <kbd class="text-[10px] px-1.5 py-0.5 rounded border border-border t3">Esc</kbd>
    </div>
    <div class="p-4 space-y-4">
      <div>
        <div class="text-xs2 t3 mb-2">热门搜索</div>
        <div class="flex flex-wrap gap-1.5">
          ${['教师', '计算机', '北京', '上海', '法学', '会计', '国考', '央企校招'].map(k => `<a href="search-results.html" class="chip tap44">${k}</a>`).join('')}
        </div>
      </div>
      <div>
        <div class="text-xs2 t3 mb-2">最近搜索</div>
        <div class="space-y-1">
          <a href="search-results.html" class="flex items-center gap-2 h-9 min-h-[44px] sm:min-h-0 px-2 rounded-md2 hover:bg-muted t1 text-body"><svg class="t3" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>教师 · 三板块 17,103 条<span class="ml-auto text-xs2 t3">昨天</span></a>
          <a href="search-results.html" class="flex items-center gap-2 h-9 min-h-[44px] sm:min-h-0 px-2 rounded-md2 hover:bg-muted t1 text-body"><svg class="t3" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>水利水电 湖南<span class="ml-auto text-xs2 t3">3 天前</span></a>
        </div>
      </div>
      <div>
        <div class="text-xs2 t3 mb-2">直达</div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <a href="calendar.html" class="btn-sec btn-sm justify-start tap44">📅 报考日历</a>
          <a href="updates.html" class="btn-sec btn-sm justify-start tap44">✨ 今日更新</a>
          <a href="favorites.html" class="btn-sec btn-sm justify-start tap44">⭐ 我的收藏</a>
          <a href="guide.html" class="btn-sec btn-sm justify-start tap44">📖 求职攻略</a>
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

  /* ============ 列表状态机（加载骨架 / 正常 / 空态 / 错误 / 0 结果） ============
     页面提供：#list-normal 正常内容容器；调用 initListStates({boards}) 后，
     右下角出现状态演示开关（原型演示用，可关闭）。 */
  window.renderSkeletonRows = function (n = 8) {
    let s = '<div class="p-3 space-y-3" aria-busy="true" aria-label="加载中">';
    for (let i = 0; i < n; i++) {
      s += `<div class="flex items-center gap-3">
        <div class="skel w-5 h-5 !rounded-full shrink-0"></div>
        <div class="flex-1 space-y-1.5"><div class="skel h-4" style="width:${55 + (i * 13) % 35}%"></div><div class="skel h-3" style="width:${30 + (i * 7) % 25}%"></div></div>
        <div class="skel h-5 w-14 shrink-0"></div><div class="skel h-5 w-16 shrink-0 hidden sm:block"></div>
      </div>`;
    }
    return s + '</div>';
  };
  window.renderEmptyState = function (msg, hint) {
    return `<div class="py-16 px-6 text-center">
      <div class="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center">
        <svg class="t3" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg>
      </div>
      <div class="mt-3 text-body font-medium t1">${msg}</div>
      <div class="mt-1 text-xs1 t3">${hint || ''}</div>
    </div>`;
  };
  window.renderErrorState = function () {
    return `<div class="py-16 px-6 text-center" role="alert">
      <div class="mx-auto w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-900/40 flex items-center justify-center">
        <svg class="text-danger" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01"/></svg>
      </div>
      <div class="mt-3 text-body font-medium t1">加载失败，请重试</div>
      <div class="mt-1 text-xs1 t3">网络异常或服务暂时不可用（错误码 502）</div>
      <button class="btn-sec btn-sm mt-4" onclick="setListState('normal')">重新加载</button>
    </div>`;
  };
  window.renderZeroState = function (boards) {
    const links = (boards || []).map(b => `<a class="btn-sec btn-sm" href="${b.href}">${b.label} ${b.count}</a>`).join('');
    return `<div class="py-14 px-6 text-center">
      <div class="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center">
        <svg class="t3" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      </div>
      <div class="mt-3 text-body font-medium t1">当前筛选下没有匹配岗位</div>
      <div class="mt-1 text-xs1 t3">试试放宽「地点」或「学历」条件；其他板块有相关结果：</div>
      <div class="mt-4 flex flex-wrap justify-center gap-2">${links}</div>
      <button class="btn-ghost btn-sm mt-3 text-brand-600" onclick="setListState('normal')">清空全部筛选</button>
    </div>`;
  };
  window.setListState = function (state) {
    const normal = document.getElementById('list-normal');
    const alt = document.getElementById('list-alt');
    if (!normal || !alt) return;
    const cfg = window.__stateCfg || {};
    if (state === 'normal') { normal.classList.remove('hidden'); alt.classList.add('hidden'); }
    else {
      normal.classList.add('hidden'); alt.classList.remove('hidden');
      alt.innerHTML = state === 'loading' ? renderSkeletonRows(10)
        : state === 'empty' ? renderEmptyState('还没有任何数据', '数据源同步中，稍后再来看看')
        : state === 'error' ? renderErrorState()
        : renderZeroState(cfg.boards);
    }
    document.querySelectorAll('#state-demo [data-state]').forEach(b =>
      b.setAttribute('aria-pressed', b.dataset.state === state ? 'true' : 'false'));
  };
  window.initListStates = function (cfg) {
    window.__stateCfg = cfg || {};
    const states = [['normal', '正常'], ['loading', '加载'], ['empty', '空态'], ['error', '错误'], ['zero', '0 结果']];
    document.body.insertAdjacentHTML('beforeend', `
<div id="state-demo" class="fixed bottom-20 md:bottom-4 right-3 z-30 s-card shadow-raised px-1.5 py-1 flex items-center gap-0.5">
  <span class="text-xs2 t3 pl-1.5 pr-0.5 hidden sm:inline">状态演示</span>
  ${states.map(([k, l]) => `<button data-state="${k}" onclick="setListState('${k}')" aria-pressed="${k === 'normal'}"
    class="text-xs2 px-2 h-6 rounded-ctl transition-colors aria-pressed:bg-primary/10 aria-pressed:text-brand-700 dark:aria-pressed:text-brand-300 aria-pressed:font-medium t2 hover:bg-muted
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">${l}</button>`).join('')}
</div>`);
    // 首次进入演示 600ms 骨架
    setListState('loading');
    setTimeout(() => setListState('normal'), 600);
  };

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
