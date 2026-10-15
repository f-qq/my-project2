(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const state = {
    items: [], sources: [], category: '全部', region: '全部', search: '', sort: 'popular',
    demoMode: false, dynamicCount: 0, favoritesOnly: false, adultAllowed: sessionStorage.getItem('sv-adult') === 'yes',
    favorites: new Set(), limit: 16, page: 1, pageSize: 16, platform: '全部', navHistory: [], lastUpdated: null, refreshHours: 6, refreshing: false, adultType: '全部'
  };
  try { state.favorites = new Set(JSON.parse(localStorage.getItem('sv-favorites') || '[]')); }
  catch { state.favorites = new Set(); }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safeUrl = (raw) => { try { const u = new URL(raw); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const fmt = (d) => {
    if (!d || !Number.isFinite(new Date(d).getTime())) return '未同步';
    const minutes = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (minutes < 1) return '刚刚更新';
    if (minutes < 60) return `${minutes} 分钟前更新`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前更新`;
    return `${Math.floor(minutes / 1440)} 天前更新`;
  };
  let toastTimeout;
  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('visible');
    clearTimeout(toastTimeout); toastTimeout = setTimeout(() => el.classList.remove('visible'), 3500);
  }
  function saveFavorites() {
    try { localStorage.setItem('sv-favorites', JSON.stringify([...state.favorites])); } catch {}
  }
  function syncSelection() {
    $$('#mainNav [data-category], #categoryTabs [data-category]').forEach(el => {
      el.classList.toggle('active', !state.favoritesOnly && el.dataset.category === state.category);
    });
    $$('#favoritesNav').forEach(el => el.classList.toggle('active', state.favoritesOnly));
    $('#adultNav').classList.toggle('active', state.category === '成人' && !state.favoritesOnly);
    $$('[data-region]').forEach(el => el.classList.toggle('active', el.dataset.region === state.region));
    $('#favCount').textContent = state.favorites.size;
    const page = state.favoritesOnly ? '我的收藏' : state.category === '全部' ? (state.demoMode ? '离线演示' : '为你推荐') : state.category === '成人' ? '成人专区' : `${state.category}精选`;
    $('#currentPage').textContent = page;
    $('#sectionTitle').innerHTML = `${esc(state.favoritesOnly ? '我的收藏' : state.category === '全部' ? (state.demoMode ? '离线示例 · 非当前热榜' : '正在热映') : state.category === '成人' ? '成人专区' : `${state.category}精选`)} <span class="section-count" id="resultCount">0</span>`;
    $('#sectionDescription').textContent = state.favoritesOnly ? '收藏保存在当前浏览器中' : state.category === '成人' ? '自动更新海外公开成人片单 · 仅限成年人 · 点击跳转原站' : '来自国内外多个来源的热榜与精彩内容';
    $('#categoryTabs').style.display = state.favoritesOnly || state.category === '成人' ? 'none' : '';
    const filter = $('#adultTypeFilters');
    filter.hidden = state.category !== '成人' || state.favoritesOnly;
    if (!filter.hidden) {
      const counts = { '全部': 0, '真人视频': 0, '成人动画': 0, 'AI成人短剧': 0 };
      state.items.filter(i => i.category === '成人').forEach(i => {
        counts['全部']++;
        counts[i.adultType === '成人动画' ? '成人动画' : i.adultType === 'AI成人短剧' ? 'AI成人短剧' : '真人视频']++;
      });
      filter.querySelectorAll('[data-adult-type]').forEach(button => {
        button.classList.toggle('active', button.dataset.adultType === state.adultType);
        button.textContent = `${button.dataset.adultType} ${counts[button.dataset.adultType]}`;
      });
    }
  }
  function navigate(category, { favoritesOnly = false, fromHistory = false } = {}) {
    if (category === '成人' && !state.adultAllowed) { $('#ageModal').hidden = false; return; }
    if (!fromHistory && (state.category !== category || state.favoritesOnly !== favoritesOnly)) {
      state.navHistory.push({category: state.category, favoritesOnly: state.favoritesOnly});
      if (state.navHistory.length > 30) state.navHistory.shift();
    }
    state.category = category; state.favoritesOnly = favoritesOnly; state.page = 1; state.platform = '全部';
    // 修复：切换分区时旧的搜索词会将已经成功抓取的成人数据全部隐藏。
    state.search = '';
    $('#searchInput').value = '';
    if (category === '成人') { state.region = '全部'; state.adultType = '全部'; }
    syncSelection(); render(); closeMenu();
    $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function matches(item) {
    if (item.category === '成人' && !(state.adultAllowed && (state.category === '成人' || state.favoritesOnly))) return false;
    if (state.category === '成人' && item.category === '成人' && state.adultType !== '全部' &&
        (item.adultType === '成人动画' ? '成人动画' : item.adultType === 'AI成人短剧' ? 'AI成人短剧' : '真人视频') !== state.adultType) return false;
    if (state.favoritesOnly) { if (!state.favorites.has(item.id)) return false; }
    else if (state.category !== '全部' && item.category !== state.category) return false;
    if (state.region !== '全部' && item.region !== state.region) return false;
    if (state.platform !== '全部' && item.platform !== state.platform) return false;
    const q = state.search.trim().toLowerCase();
    return !q || [item.title, item.description, item.source, item.category, ...(item.tags || [])].join(' ').toLowerCase().includes(q);
  }
  function sorted(items) {
    const list = [...items];
    switch (state.sort) {
      case 'recent': list.sort((a, b) => (Date.parse(b.publishedAt || `${b.year}-01-01`) || 0) - (Date.parse(a.publishedAt || `${a.year}-01-01`) || 0)); break;
      case 'rating': list.sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
      case 'name': list.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')); break;
      default: list.sort((a, b) => (b.trend || 0) - (a.trend || 0));
    }
    return list;
  }
  function categoryBadge(item) {
    if (item.category === 'AI视频') return '✦ AI 创作';
    if (item.category === '短剧') return '短剧精选';
    if (item.category === '动漫') return '动漫';
    if (item.category === '成人') return item.adultType === 'AI成人短剧' ? '✦ 18+ AI 短片' : item.adultType === '成人动画' ? '18+ 动画' : '18+';
    return item.category;
  }
  function poster(item) {
    const url = safeUrl(item.poster);
    if (!url) return '<span class="cover-unavailable">来源未提供可用封面</span>';
    // 成人作品在完成年龄确认后才会进入 DOM。
    return `<img src="${esc(url)}" data-id="${esc(item.id)}" data-cover-stage="direct" loading="lazy" alt="${esc(item.title)} 封面" referrerpolicy="no-referrer">`;
  }
  function card(item, i) {
    const favorite = state.favorites.has(item.id);
    const badge = categoryBadge(item);
    return `<article class="media-card${item.category === '成人' ? ' adult-card' : ''}" role="link" tabindex="0" data-open="${esc(item.id)}" aria-label="打开 ${esc(item.title)}，前往原平台">
      <div class="poster-wrap">${poster(item)}<span class="poster-badge${i < 3 ? ' hot' : ''}">${esc(i < 3 ? '↗ ' + badge : badge)}</span>
        <span class="poster-hover-play">${icon('play')}</span><span class="poster-platform">${esc(item.platform || item.source || '其他来源')}</span><span class="poster-time">${esc(item.region || '')} · ${esc(item.year || '精选')}</span>
        <button type="button" class="favorite-button${favorite ? ' active' : ''}" data-fav="${esc(item.id)}" aria-label="${favorite ? '取消收藏' : '收藏'} ${esc(item.title)}" title="${favorite ? '取消收藏' : '加入收藏'}">${icon('heart')}</button>
      </div><div class="media-details"><h3 title="${esc(item.title)}">${esc(item.title)}</h3>
        <div class="media-sub"><span class="source-name" title="${esc(item.source)}">${esc(item.platform || item.source || '精选')}</span><span class="midpoint">·</span><span>${esc(item.region || '海外')}</span></div>
        <div class="media-card-footer"><span class="media-tag">${esc(item.dataKind === '示例' ? '离线示例 · 非实时热榜' : item.dataKind === '近期上线' ? '近期上线' : item.dataKind === '频道更新' ? '官方频道更新' : item.tags?.[0] || item.category || '精选')}</span><span class="card-link">${esc(item.action || '前往观看')} ↗</span></div>
      </div></article>`;
  }
  function updatePlatformOptions() {
    const select = $('#platformFilter');
    const options = [...new Set(state.items.filter(item => item.category !== '成人' || state.category === '成人')
      .filter(item => state.category === '全部' || item.category === state.category)
      .filter(item => state.category !== '成人' || state.adultType === '全部' || item.adultType === state.adultType)
      .map(item => item.platform || item.source).filter(Boolean))].sort();
    select.innerHTML = '<option value="全部">全部平台</option>' + options.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    if (!options.includes(state.platform)) state.platform = '全部';
    select.value = state.platform;
  }
  function render() {
    updatePlatformOptions();
    const filtered = sorted(state.items.filter(matches));
    if (state.category === '成人' && !state.favoritesOnly) {
      const adultItems = state.items.filter(x => x.category === '成人');
      const real = adultItems.filter(x => x.adultType === '真人视频').length;
      const anime = adultItems.filter(x => x.adultType === '成人动画').length;
      const ai = adultItems.filter(x => x.adultType === 'AI成人短剧').length;
      $('#sectionDescription').textContent = `已收录 ${adultItems.length} 条 · 真人影片 ${real} · 成人动画 ${anime} · AI 成人短片候选 ${ai}；仅显示实际返回的片单。`;
    }
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    state.page = Math.min(Math.max(1,state.page), totalPages);
    const first = (state.page - 1) * state.pageSize;
    $('#mediaGrid').innerHTML = filtered.slice(first, first + state.pageSize).map((item,i) => card(item, first + i)).join('');
    $('#pagination').hidden = filtered.length <= state.pageSize;
    $('#pageLabel').textContent = `第 ${state.page} / ${totalPages} 页 · 共 ${filtered.length} 条`;
    $('#prevPage').disabled = state.page <= 1;
    $('#nextPage').disabled = state.page >= totalPages;
    $('#backSection').disabled = state.navHistory.length === 0;
    $('#refreshHint').textContent = state.category === '成人' ? '当前专区仅刷新对应来源；平台返回失败仍保留缓存' : '刷新当前专区的数据源，不清空其他专区缓存';
    $('#resultCount').textContent = filtered.length;
    $('#emptyState').hidden = filtered.length > 0;
    $('#showMoreWrap').hidden = true;
    if (!filtered.length) {
      $('#emptyHint').textContent = state.category === '成人'
        ? (() => {
          const failed = state.sources.filter(x => ['eporner-week', 'eporner-new', 'eporner-ai', 'huangguo-ai', 'anilist-adult', 'jikan-adult'].includes(x.id) && !x.ok);
          const error = failed.find(x => x.error)?.error || '';
          const totalAdult = state.items.filter(x => x.category === '成人').length;
          return totalAdult > 0
            ? `已获取 ${totalAdult} 条成人条目，但当前筛选没有匹配结果。请清空搜索或切换「全部」。`
            : `该类型目前没有实时条目。${error ? '来源报错：' + error.slice(0, 180) + '。' : ''}请点击「查看来源」核对状态，或运行 diagnose-sources.bat。`;
        })()
        : state.favoritesOnly ? '还没有收藏内容。点击视频封面右上角的爱心即可收藏。'
        : '这个筛选条件暂时没有内容。可以切换分类，或尝试刷新热榜。';
    }
    $('#favCount').textContent = state.favorites.size;
    if (state.category === '成人') $('#clearFilters').textContent = '检查数据源详情 →';
    else $('#clearFilters').textContent = '查看全部内容 →';
  }
  function updateHero() {
    const featured = sorted(state.items.filter(item => item.category !== '成人' && item.category !== '视频'))[0]
      || state.items.find(item => item.category !== '成人');
    $('#totalStat').textContent = state.dynamicCount.toLocaleString('zh-CN');
    const hero = $('#featuredHero');
    if (!featured) return;
    const title = esc(featured.title);
    const desc = esc(featured.description || `${featured.category} · ${featured.source}`);
    hero.querySelector('.hero-content').innerHTML = `<span class="hero-label"><span class="hero-label-star">✦</span> ${state.demoMode ? 'OFFLINE DEMO · 非实时热榜' : 'TRENDING NOW · 今日精选'}</span><h2>${title}</h2><p>${desc}</p><button class="primary-cta" id="heroWatch">${icon('play')} ${esc(featured.action || '前往观看')} <span>↗</span></button>`;
    const u = safeUrl(featured.poster);
    if (u) {
      hero.classList.add('has-poster');
      hero.style.backgroundImage = `linear-gradient(90deg, #1a1729 0%, #171428e3 45%, #18132588 100%), url(${JSON.stringify(u)})`;
      hero.style.backgroundPosition = 'center, right 25% center'; hero.style.backgroundSize = 'cover';
    }
    $('#heroWatch').addEventListener('click', () => openItem(featured));
  }
  function openItem(item) {
    if (item.category === '成人' && !state.adultAllowed) { $('#ageModal').hidden = false; return; }
    const url = safeUrl(item.url);
    if (!url) { toast('该条目的链接不可用'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  async function load() {
    try {
      const response = await fetch('/api/videos', { cache: 'no-store' });
      if (!response.ok) throw new Error(`服务器 ${response.status}`);
      const data = await response.json();
      state.items = Array.isArray(data.items) ? data.items : [];
      state.sources = data.sources || []; state.lastUpdated = data.lastUpdated;
      state.demoMode = Boolean(data.demoMode); state.dynamicCount = Number(data.dynamicCount || 0);
      state.refreshHours = data.refreshHours || 6; state.refreshing = Boolean(data.refreshing);
      $('#sidebarRefresh').textContent = state.refreshHours;
      const okCount = state.sources.filter(x => x.ok).length;
      $('#updateText').textContent = data.refreshing ? '正在从平台更新...' : data.demoMode ? '未获取到在线热榜' : fmt(data.lastUpdated);
      $('#updateDesc').textContent = data.demoMode
        ? `仅展示 ${state.items.length} 条离线示例，非当前热门 · ${okCount}/${state.sources.length} 个来源成功`
        : `真实在线内容 ${state.dynamicCount} 条 · ${okCount}/${state.sources.length} 个来源成功 · 每 ${state.refreshHours} 小时刷新`;
      $('#sectionDescription').textContent = data.demoMode && state.category !== '成人' ? '当前网络采集失败，以下为演示视频，并非近期热门！点击底部查看来源。'
        : state.category === '成人' ? '来自成人平台的公开榜单 · 仅限成年人 · 访问须遵守所在地区法律'
        : '来自国内外多个真实来源的榜单、近期上映和官方频道更新（已区分数据类型）';
      $('#syncButton').classList.toggle('spinning', data.refreshing);
      updateHero(); syncSelection();
      if (state.demoMode && state.category !== '成人') $('#sectionDescription').textContent = '离线示例，不代表当前热门。请通过「查看来源」检查采集失败原因。';
      render();
      return data;
    } catch (error) {
      $('#updateText').textContent = '数据暂不可用';
      toast(`无法连接本地服务：${error.message}`);
      return null;
    }
  }
  async function refresh(scope = 'all') {
    const button = $('#syncButton');
    if (state.refreshing) { toast('热榜正在更新中'); return; }
    button.classList.add('spinning');
    let token = sessionStorage.getItem('sv-token') || '';
    async function post() {
      return fetch(`/api/refresh?scope=${encodeURIComponent(scope)}`, { method: 'POST', headers: token ? { 'X-Admin-Token': token } : {} });
    }
    try {
      let response = await post();
      if (response.status === 403) {
        const entered = window.prompt('远程同步需要管理员口令（本机 localhost 访问默认无需口令）：');
        if (!entered) { button.classList.remove('spinning'); return; }
        token = entered; sessionStorage.setItem('sv-token', entered);
        response = await post();
      }
      if (!response.ok) throw new Error((await response.json()).error || '刷新请求失败');
      toast(scope === 'all' ? '已开始同步全部数据源' : `正在更新「${scope}」专区，稍后自动显示新数据`);
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const result = await load();
        if ((result && !result.refreshing) || attempts >= 25) {
          clearInterval(interval); button.classList.remove('spinning');
        }
      }, 1400);
    } catch (error) { button.classList.remove('spinning'); toast(error.message); }
  }
  function closeMenu() { $('#sidebar').classList.remove('open'); $('#mobileShade').classList.remove('visible'); }
  function sourceModal() {
    $('#sourcesList').innerHTML = state.sources.length ? state.sources.map(s =>
      `<div class="source-item"><div><strong>${esc(s.name)}</strong>${s.error ? `<small>${esc(s.error)}</small>` : ''}${s.cached ? '<small>正在使用最近成功的缓存（最长保留7天）</small>' : ''}</div><span class="source-stat${s.ok ? '' : ' err'}">${s.ok ? `✓ ${s.count} 条` : s.cached ? '缓存' : '暂不可用'}</span></div>`
    ).join('') : '<p style="color:#8a89a3;font-size:12px">还没有首次同步记录。</p>';
    $('#sourcesModal').hidden = false;
  }
  function events() {
    $$('#mainNav [data-category], #categoryTabs [data-category]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.category)));
    $$('[data-region]').forEach(el => el.addEventListener('click', () => { state.region = el.dataset.region; state.page = 1; syncSelection(); render(); }));
    $('#searchInput').addEventListener('input', e => { state.search = e.target.value; state.page = 1; render(); });
    $('#sortSelect').addEventListener('change', e => { state.sort = e.target.value; state.page = 1; render(); });
    $('#favoritesNav').addEventListener('click', () => navigate('全部', { favoritesOnly: true }));
    $('#adultNav').addEventListener('click', () => navigate('成人'));
    $('#ageCancel').addEventListener('click', () => { $('#ageModal').hidden = true; });
    $('#ageConfirm').addEventListener('click', () => {
      state.adultAllowed = true; sessionStorage.setItem('sv-adult', 'yes');
      $('#ageModal').hidden = true; navigate('成人');
    });
    $('#mediaGrid').addEventListener('error', e => {
      const img = e.target;
      if (!img.matches('img[data-id]')) return;
      const item = state.items.find(x => x.id === img.dataset.id);
      if (img.dataset.coverStage === 'direct' && item?.category === '成人') {
        img.dataset.coverStage = 'proxy';
        img.src = `/api/cover?id=${encodeURIComponent(item.id)}`;
      } else {
        img.replaceWith(Object.assign(document.createElement('span'), { className:'cover-unavailable', textContent:'真实封面加载失败 · 可点击查看原站' }));
      }
    }, true);
    $('#mediaGrid').addEventListener('click', e => {
      const f = e.target.closest('[data-fav]');
      if (f) {
        const id = f.dataset.fav;
        if (state.favorites.has(id)) { state.favorites.delete(id); toast('已移出收藏'); }
        else { state.favorites.add(id); toast('已加入收藏'); }
        saveFavorites(); render(); return;
      }
      const card = e.target.closest('[data-open]');
      if (!card) return;
      const item = state.items.find(x => x.id === card.dataset.open);
      if (item) openItem(item);
    });
    $('#mediaGrid').addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.media-card')) {
        e.preventDefault(); const item = state.items.find(x => x.id === e.target.dataset.open);
        if (item) openItem(item);
      }
    });
    $('#showMore').addEventListener('click', () => { state.page++; render(); });
    $('#prevPage').addEventListener('click', () => { state.page--; render(); $('#catalog').scrollIntoView({behavior:'smooth'}); });
    $('#nextPage').addEventListener('click', () => { state.page++; render(); $('#catalog').scrollIntoView({behavior:'smooth'}); });
    $('#backSection').addEventListener('click', () => { const previous = state.navHistory.pop(); if (previous) navigate(previous.category, {...previous, fromHistory:true}); });
    $('#platformFilter').addEventListener('change', e => { state.platform = e.target.value; state.page = 1; render(); });
    $('#sectionRefresh').addEventListener('click', () => refresh(state.category === '成人' && state.adultType !== '全部' ? state.adultType : state.category));
    $('#clearFilters').addEventListener('click', () => {
      if (state.category === '成人') {
        if (state.items.some(x => x.category === '成人')) {
          state.search = ''; $('#searchInput').value = ''; state.adultType = '全部'; state.region = '全部';
          syncSelection(); render(); return;
        }
        sourceModal(); return;
      }
      state.region = '全部'; state.search = ''; $('#searchInput').value = ''; navigate('全部');
    });
    $$('#adultTypeFilters [data-adult-type]').forEach(button => button.addEventListener('click', () => {
      state.adultType = button.dataset.adultType;
      state.page = 1; state.platform = '全部';
      syncSelection(); render();
    }));
    $('#heroExplore').addEventListener('click', () => $('#catalog').scrollIntoView({ behavior: 'smooth' }));
    $('#syncButton').addEventListener('click', () => refresh('all'));
    $('#sourcesToggle').addEventListener('click', sourceModal);
    $('#sourcesClose').addEventListener('click', () => { $('#sourcesModal').hidden = true; });
    $('#menuButton').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#mobileShade').classList.add('visible'); });
    $('#mobileShade').addEventListener('click', closeMenu);
    $$('.modal-backdrop').forEach(modal => modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; }));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeMenu(); $$('.modal-backdrop').forEach(el => el.hidden = true); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#searchInput').focus(); }
    });
  }
  events();
  // 首次进入时，服务器往往正在采集，短间隔轮询直到第一轮完成。
  load().then(first => {
    if (!first?.refreshing) return;
    let checks = 0;
    const timer = setInterval(async () => {
      const next = await load();
      if (!next?.refreshing || ++checks >= 25) clearInterval(timer);
    }, 1400);
  });
  // 页面保持打开时每 60 秒重新读取服务器缓存状态；不是重复向外站采集。
  setInterval(load, 60000);
})();
