/* R179 风格候选小样共享引擎：同一份数据（assets/data.js 的 DATA_POSITIONS）、
   同一信息结构（顶栏/筛选 chips/工具栏/岗位列表/分页/移动卡片+底栏），
   每个 style-x.html 只提供一份 CSS（变量 + 可选覆盖）决定观感。
   结构类名前缀 sd-，全部样式钩子见各 style 页内 <style>。 */
(function () {
  const S = window.STYLE || {};
  document.title = `${S.key || ''} ${S.name || '风格小样'} · 上岸罗盘 R179`;

  const CHIPS = ['全部 10,000+', '公务员', '事业编', '军队文职', '国企央企', '选调生', '2027 最新', '即将截止 20', '近 7 天更新'];
  const rows = (window.DATA_POSITIONS || []).slice(0, 20);

  const tagCls = (t) => t === '省级公务员考试' ? 'sd-tag sd-tag-b' : (t === '事业单位' ? 'sd-tag sd-tag-c' : 'sd-tag');
  const edu = (e) => e || '详见公告';
  const dl = (d, i) => {
    if (i === 0) return '<span class="sd-danger">今日截止</span>';
    if (!d) return '<span class="sd-sub2">详见公告</span>';
    return `<span class="sd-sub2">${d.slice(5, 10)}</span>`;
  };

  const html = `
<div class="sd-banner">
  <div class="sd-banner-in">
    <span class="sd-banner-tag">${S.key || ''} · ${S.name || ''}</span>
    <span class="sd-banner-ref">参考：${S.ref || ''}</span>
    <a href="styles.html" class="sd-banner-back">← 返回风格选择页</a>
  </div>
</div>
<header class="sd-header">
  <div class="sd-header-in">
    <a class="sd-logo" href="styles.html"><span class="sd-logo-mark">◈</span>上岸罗盘</a>
    <nav class="sd-nav">
      <a class="sd-nav-a sd-nav-on" href="#">体制内</a><a class="sd-nav-a" href="#">校招</a><a class="sd-nav-a" href="#">编制</a><a class="sd-nav-a" href="#">日历</a><a class="sd-nav-a" href="#">今日更新</a>
    </nav>
    <div class="sd-sp"></div>
    <div class="sd-search"><span class="sd-search-ic">⌕</span>搜索岗位 / 单位 / 专业<kbd class="sd-kbd">Ctrl K</kbd></div>
    <button class="sd-btn sd-btn-sec">☆ 收藏 <span class="sd-count">6</span></button>
  </div>
</header>
<main class="sd-main">
  <div class="sd-chips">${CHIPS.map((c, i) => `<button class="sd-chip${i === 0 ? ' sd-chip-on' : ''}">${c}</button>`).join('')}</div>
  <div class="sd-toolbar">
    <div class="sd-input-wrap"><input class="sd-input" placeholder="搜索岗位、单位、专业、地点…"></div>
    <button class="sd-btn sd-btn-sec">筛选 <span class="sd-count">3</span></button>
    <button class="sd-btn sd-btn-sec sd-hide-m">最新优先 ▾</button>
    <button class="sd-btn sd-btn-pri">一键匹配</button>
  </div>
  <div class="sd-meta">共 <b>10,000+</b> 条 · 数据更新于 12 小时前 <span class="sd-sp"></span><a class="sd-link" href="#">导出 CSV</a></div>
  <div class="sd-card sd-list-wrap">
    <table class="sd-tbl">
      <thead><tr><th></th><th>岗位 / 用人单位</th><th>年份</th><th>类型</th><th>地点</th><th>学历</th><th>截止</th><th></th></tr></thead>
      <tbody>${rows.map((p, i) => `
        <tr class="${i === 3 ? 'sd-row-sel' : ''}">
          <td class="sd-fav">${i === 1 ? '★' : '☆'}</td>
          <td><div class="sd-title">${p.title}</div><div class="sd-sub">${p.employer}</div></td>
          <td><span class="sd-tag">${p.year}</span></td>
          <td><span class="${tagCls(p.type)}">${p.type}</span></td>
          <td class="sd-sub2">${p.loc}</td>
          <td class="sd-sub2">${edu(p.edu)}</td>
          <td>${dl(p.deadline, i)}</td>
          <td><a class="sd-link" href="#">报名 ↗</a></td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="sd-cards">${rows.map((p, i) => `
      <div class="sd-mcard">
        <div class="sd-mcard-top"><span class="sd-title">${p.title}</span><span class="sd-fav">${i === 1 ? '★' : '☆'}</span></div>
        <div class="sd-sub">${p.employer}</div>
        <div class="sd-mcard-tags"><span class="sd-tag">${p.year}</span><span class="${tagCls(p.type)}">${p.type}</span><span class="sd-tag">${edu(p.edu)}</span></div>
        <div class="sd-mcard-foot"><span class="sd-sub2">${p.loc}</span><span class="sd-sp"></span>${dl(p.deadline, i)}</div>
      </div>`).join('')}
    </div>
  </div>
  <div class="sd-pager"><button class="sd-btn sd-btn-sec">‹ 上一页</button><span class="sd-sub2">1 / 500</span><button class="sd-btn sd-btn-sec">下一页 ›</button></div>
</main>
<nav class="sd-bottom">
  <a class="sd-bottom-a sd-bottom-on" href="#">岗位</a><a class="sd-bottom-a" href="#">日历</a><a class="sd-bottom-a" href="#">搜索</a><a class="sd-bottom-a" href="#">收藏</a><a class="sd-bottom-a" href="#">攻略</a>
</nav>`;

  const BASE = `
*{box-sizing:border-box;margin:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;background:var(--bg);color:var(--fg);font-size:14px}
a{text-decoration:none;color:inherit}
button{font:inherit;cursor:pointer}
.sd-sp{flex:1}
.sd-banner{background:var(--banner-bg,var(--fg));color:var(--banner-fg,var(--bg));font-size:12px}
.sd-banner-in{max-width:1240px;margin:0 auto;padding:6px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.sd-banner-back{margin-left:auto;text-decoration:underline}
.sd-header{position:sticky;top:0;z-index:10;background:var(--header-bg,var(--card));border-bottom:var(--bw,1px) solid var(--line)}
.sd-header-in{max-width:1240px;margin:0 auto;padding:0 16px;height:56px;display:flex;align-items:center;gap:14px}
.sd-logo{font-weight:700;font-size:16px;display:flex;align-items:center;gap:8px;color:var(--header-fg,var(--fg))}
.sd-logo-mark{width:28px;height:28px;border-radius:var(--r-logo,var(--r-ctl));background:var(--accent);color:var(--accent-fg);display:flex;align-items:center;justify-content:center;font-size:14px}
.sd-nav{display:flex;gap:2px}
.sd-nav-a{padding:6px 10px;border-radius:var(--r-ctl);color:var(--fg2);font-size:14px}
.sd-nav-a:hover{background:var(--muted);color:var(--header-fg,var(--fg))}
.sd-nav-on{background:var(--accent-weak);color:var(--accent-text,var(--accent));font-weight:600}
.sd-search{display:flex;align-items:center;gap:8px;border:var(--bw,1px) solid var(--line);border-radius:var(--r-ctl);height:34px;padding:0 10px;width:240px;color:var(--fg3);font-size:12px;background:var(--input-bg,var(--card))}
.sd-search-ic{font-size:15px}
.sd-kbd{margin-left:auto;border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:10px}
.sd-count{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:var(--r-badge,var(--r-ctl));background:var(--accent-weak);color:var(--accent-text,var(--accent));font-size:11px;font-weight:600}
.sd-main{max-width:1240px;margin:0 auto;padding:16px}
.sd-chips{display:flex;gap:var(--chip-gap,8px);flex-wrap:wrap}
.sd-chip{display:inline-flex;align-items:center;height:var(--chip-h,26px);padding:0 10px;border-radius:var(--r-chip,var(--r-ctl));border:var(--bw,1px) solid var(--line);background:var(--chip-bg,var(--card));color:var(--fg2);font-size:12px}
.sd-chip:hover{border-color:var(--accent);color:var(--accent-text,var(--accent))}
.sd-chip-on{border-color:var(--chip-on-bd,var(--accent));background:var(--chip-on-bg);color:var(--chip-on-fg);font-weight:600}
.sd-toolbar{display:flex;gap:8px;margin-top:12px;align-items:center}
.sd-input-wrap{flex:1;max-width:560px}
.sd-input{width:100%;height:var(--ctl-h,34px);border:var(--bw,1px) solid var(--line);border-radius:var(--r-ctl);padding:0 10px;background:var(--input-bg,var(--card));color:var(--fg);font-size:13px;outline:none}
.sd-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--ring,transparent)}
.sd-btn{display:inline-flex;align-items:center;gap:6px;height:var(--ctl-h,34px);padding:0 12px;border-radius:var(--r-btn,var(--r-ctl));font-size:13px;font-weight:500;border:var(--bw,1px) solid transparent;white-space:nowrap}
.sd-btn-pri{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);box-shadow:var(--btn-shadow,none)}
.sd-btn-pri:hover{filter:brightness(1.08)}
.sd-btn-sec{background:var(--btn-sec-bg,var(--card));color:var(--fg);border-color:var(--line);box-shadow:var(--btn-shadow,none)}
.sd-btn-sec:hover{background:var(--muted)}
.sd-meta{margin-top:12px;color:var(--fg3);font-size:12px;display:flex;gap:8px;align-items:center}
.sd-card{background:var(--card);border:var(--bw,1px) solid var(--line);border-radius:var(--r-card);box-shadow:var(--card-shadow,none)}
.sd-list-wrap{margin-top:8px;overflow:hidden}
.sd-tbl{width:100%;border-collapse:collapse}
.sd-tbl th{text-align:left;font-size:12px;font-weight:500;color:var(--fg3);padding:var(--th-py,8px) 12px;border-bottom:var(--bw,1px) solid var(--line);background:var(--th-bg,transparent);white-space:nowrap}
.sd-tbl td{padding:var(--td-py,10px) 12px;border-bottom:1px solid var(--row-line,var(--line));vertical-align:top;font-size:13px}
.sd-tbl tbody tr:hover{background:var(--row-hover)}
.sd-row-sel{background:var(--row-sel)!important}
.sd-fav{color:var(--fg3);width:28px}
.sd-title{font-weight:var(--title-w,600);font-size:var(--title-s,14px);color:var(--fg)}
.sd-sub{color:var(--fg3);font-size:12px;margin-top:2px}
.sd-sub2{color:var(--fg2);font-size:12px}
.sd-tag{display:inline-flex;align-items:center;height:20px;padding:0 6px;border-radius:var(--r-tag,var(--r-ctl));background:var(--tag-bg,var(--muted));color:var(--tag-fg,var(--fg2));font-size:11px;font-weight:500;border:var(--tag-bw,0) solid var(--line);white-space:nowrap}
.sd-tag-b{background:var(--tag-b-bg,var(--accent-weak));color:var(--tag-b-fg,var(--accent-text,var(--accent)))}
.sd-tag-c{background:var(--tag-c-bg,var(--muted));color:var(--tag-c-fg,var(--fg2))}
.sd-danger{color:var(--danger,#dc2626);font-weight:600;font-size:12px}
.sd-link{color:var(--accent-text,var(--accent));font-size:13px;font-weight:500}
.sd-pager{display:flex;gap:10px;align-items:center;justify-content:center;margin:16px 0 60px}
.sd-cards{display:none}
.sd-bottom{display:none}
@media(max-width:767px){
  .sd-nav,.sd-search,.sd-hide-m{display:none}
  .sd-tbl{display:none}
  .sd-cards{display:grid;gap:10px;padding:10px}
  .sd-list-wrap{background:transparent;border:none;box-shadow:none}
  .sd-mcard{background:var(--card);border:var(--bw,1px) solid var(--line);border-radius:var(--r-card);box-shadow:var(--card-shadow,none);padding:12px}
  .sd-mcard-top{display:flex;justify-content:space-between;gap:8px}
  .sd-mcard-tags{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
  .sd-mcard-foot{display:flex;gap:8px;margin-top:8px;align-items:center}
  .sd-bottom{position:fixed;bottom:0;left:0;right:0;display:grid;grid-template-columns:repeat(5,1fr);background:var(--card);border-top:var(--bw,1px) solid var(--line);z-index:10}
  .sd-bottom-a{display:flex;align-items:center;justify-content:center;min-height:48px;font-size:12px;color:var(--fg3)}
  .sd-bottom-on{color:var(--accent-text,var(--accent));font-weight:600}
  .sd-pager{margin-bottom:76px}
}`;
  const st = document.createElement('style');
  st.textContent = BASE;
  document.head.appendChild(st);
  document.addEventListener('DOMContentLoaded', () => { document.body.innerHTML = html + document.body.innerHTML; });
})();
