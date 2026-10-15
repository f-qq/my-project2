import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { feeds, mergeItems } from './collector.js';
import { feedsForScope } from './server-config.js';
import { initializeProxy } from './proxy-init.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const CACHE_PATH = path.join(DATA, 'cache.json');
const MANUAL_PATH = path.join(DATA, 'manual.json');
const DEMO_PATH = path.join(DATA, 'demo.json');
const MAX_CACHE_AGE_MS = 7 * 24 * 3600_000;
const PORT_CONFIGURED = Boolean(process.env.PORT?.trim());
const PORT = Number(process.env.PORT || 37925);
// 成人内容聚合默认仅允许本机访问；需要局域网部署时须主动设置 HOST。
const HOST = process.env.HOST || '127.0.0.1';
const REFRESH_HOURS = Math.min(72, Math.max(1, Number(process.env.REFRESH_HOURS || 6)));
const INTERVAL = REFRESH_HOURS * 3600000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const HEALTHY = new Set(['GET', 'HEAD']);
let state = { items: [], lastUpdated: null, lastAttempt: null, sources: [], refreshing: false, dynamicCount: 0, demoMode: false, cachedCount: 0 };
let sourcesCache = {};
const APP_VERSION = '1.5.0';
const PROXY_STATUS = initializeProxy();
let updating = null;


async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (err) { if (err.code !== 'ENOENT') console.warn(`读取 ${path.basename(file)} 失败: ${err.message}`); return fallback; }
}
async function writeCache(data) {
  const tmp = `${CACHE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, CACHE_PATH);
}
function safeManual(items) { return (Array.isArray(items) ? items : []).filter(x => x && typeof x === 'object'); }
async function loadManual() { return safeManual(await readJSON(MANUAL_PATH, [])); }
async function getVisibleItems() {
  const manual = mergeItems(await loadManual());
  const time = Date.now();
  const kept = Object.values(sourcesCache).filter(x => x &&
    Date.parse(x.updatedAt || '') > time - MAX_CACHE_AGE_MS);
  // v1.4 旧版主动丢弃真实标题和封面；隐藏该类伪造序号卡片，待新采集成功后自动替换。
  const legacyStub = x => x?.category === '成人' && /^(成人影片\s*[·・]\s*(本周热门|最新发布)|成人动画\s*[·・]\s*(人气目录|MAL 目录))/u.test(String(x.title || ''));
  const dynamic = mergeItems(...kept.map(x => (x.items || []).filter(x => !legacyStub(x)))).slice(0, 500);
  const items = mergeItems(manual, dynamic);
  if (!items.some(x => x.category !== '成人')) {
    const demo = mergeItems(await readJSON(DEMO_PATH, []));
    return { items: mergeItems(items, demo), dynamicCount: dynamic.length, demoMode: true,
      cachedCount: kept.reduce((n, x) => n + x.items.length, 0) };
  }
  return { items, dynamicCount: dynamic.length, demoMode: false,
    cachedCount: kept.reduce((n, x) => n + x.items.length, 0) };
}
async function initData() {
  await fs.mkdir(DATA, { recursive: true });
  const cached = await readJSON(CACHE_PATH, { sourcesCache: {}, lastUpdated: null, sources: [] });
  sourcesCache = cached.sourcesCache || {};
  state = { ...state, ...await getVisibleItems(), lastUpdated: cached.lastUpdated,
    sources: cached.sources || [], refreshing: false };
}
function diagnostic(error) {
  const message = String(error?.message || error || '未知错误');
  if (/fetch failed|aborted|timeout|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i.test(message))
    return `${message}（网络访问失败；若启用了 v2rayN，请改用 start-with-proxy.bat 并填写 HTTP 代理端口）`;
  if (/B站接口.*-352|B站接口.*-412|HTTP 412|HTTP 403/i.test(message))
    return `${message}（站点风控或接口限制，不能保证抓取成功）`;
  if (/HTTP 503|HTTP 502|HTTP 429/i.test(message))
    return `${message}（上游服务暂不可用或频率受限，保留最近成功缓存）`;
  return message;
}
async function refresh(scope = 'all') {
  if (updating) return updating;
  updating = (async () => {
    state.refreshing = true;
    const selected = feedsForScope(scope);
    const results = await Promise.all(selected.map(async (feed) => {
      try {
        const items = mergeItems(await feed.collect());
        if (!items.length) throw new Error('该来源返回 0 条有效数据');
        console.log(`✓ ${feed.name}: ${items.length} 条`);
        return { id: feed.id, name: feed.name, ok: true, count: items.length, items };
      } catch (e) {
        console.warn(`× ${feed.name}: ${diagnostic(e)}`);
        return { id: feed.id, name: feed.name, ok: false, count: 0,
          error: diagnostic(e), items: [] };
      }
    }));
    const now = new Date().toISOString();
    for (const result of results) {
      if (result.ok) sourcesCache[result.id] = { items: result.items, updatedAt: now };
    }
    const anySuccess = results.some(s => s.ok);
    const lastUpdated = anySuccess ? now : state.lastUpdated;
    const previous = new Map(state.sources.map(s => [s.id, s]));
    const sources = results.map(({ id, name, ok, count, error }) => ({ id, name, ok, count,
      cached: !ok && Boolean(sourcesCache[id]?.items?.length),
      ...(sourcesCache[id]?.updatedAt ? { updatedAt: sourcesCache[id].updatedAt } : {}),
      ...(error && { error }) }));
    for (const s of sources) previous.set(s.id, s);
    const mergedSources = [...previous.values()];
    const view = await getVisibleItems();
    await writeCache({ sourcesCache, lastUpdated, sources: mergedSources });
    state = { ...state, ...view, lastUpdated, lastAttempt: now, sources: mergedSources, refreshing: false };
    console.log(`${anySuccess ? '✓' : '⚠'} 更新结束：${results.filter(x => x.ok).length}/${results.length} 个来源成功；真实内容 ${view.dynamicCount} 条${view.demoMode ? '；当前显示离线示例（不是热榜）' : ''}`);
  })().finally(() => { state.refreshing = false; updating = null; });
  return updating;
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
}
function localIP(ip = '') { return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'; }
function canRefresh(req) {
  if (ADMIN_TOKEN) return req.headers['x-admin-token'] === ADMIN_TOKEN;
  return localIP(req.socket.remoteAddress);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' };
async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.resolve(PUBLIC, relative);
  if (full !== PUBLIC && !full.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Forbidden' });
  const ext = path.extname(full).toLowerCase();
  if (!MIME[ext]) return json(res, 404, { error: 'Not found' });
  try {
    const body = await fs.readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'public, max-age=120', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { json(res, 404, { error: 'Not found' }); }
}

function listenOnPort(server, port) {
  return new Promise((resolve, reject) => {
    function onError(err) {
      server.off('listening', onListening);
      reject(err);
    }
    function onListening() {
      server.off('error', onError);
      resolve();
    }
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

async function choosePort(server) {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const candidates = PORT_CONFIGURED ? [PORT] : Array.from({ length: 11 }, (_, i) => PORT + i);
  for (const port of candidates) {
    try {
      await listenOnPort(server, port);
      return port;
    } catch (err) {
      if (err.code === 'EADDRINUSE' && !PORT_CONFIGURED && port < candidates.at(-1)) {
        console.warn(`Port ${port} is already in use. Trying port ${port + 1}...`);
      } else {
        throw err;
      }
    }
  }
  throw new Error('No available local web port was found.');
}

function openBrowser(port) {
  if (process.platform !== 'win32' || process.env.AUTO_OPEN_BROWSER !== '1') return;
  // The port is validated as an integer above, so it cannot inject shell commands.
  exec(`start "" "http://127.0.0.1:${port}"`, { windowsHide: true }, err => {
    if (err) console.warn(`Browser could not open automatically: ${err.message}`);
  });
}

async function start() {
  await initData();
  const server = http.createServer(async (req, res) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; }
    catch { return json(res, 400, { error: 'Bad URL' }); }
    if (pathname === '/api/cover' && req.method === 'GET') {
      // 仅代理 API 实际抓取的海报，不接受客户端自定义 URL，避免 SSRF。
      const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
      const item = state.items.find(x => x.id === id && x.category === '成人');
      if (!item?.poster) return json(res, 404, {error:'该条目没有真实封面'});
      let cover;
      try { cover = new URL(item.poster); } catch { return json(res, 400, {error:'封面网址无效'}); }
      const host = cover.hostname.toLowerCase();
      const allowed = ['eporner.com','eporner.net','epornercdn.com','anilist.co','myanimelist.net','mal-cdn.net','huangguodrama.ai'];
      const permitted = allowed.some(domain => host === domain || host.endsWith('.'+domain));
      if (cover.protocol !== 'https:' || !permitted) return json(res, 403, {error:'该来源封面暂不支持代理'});
      try {
        const upstream = await fetch(cover, { redirect: 'error', signal: AbortSignal.timeout(8500),
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': item.platform === 'Eporner' ? 'https://www.eporner.com/' : 'https://anilist.co/' } });
        const contentType = upstream.headers.get('content-type') || '';
        const contentLength = Number(upstream.headers.get('content-length') || 0);
        if (!upstream.ok || !/^image\/(jpeg|png|webp|gif)/i.test(contentType) || contentLength > 3_000_000) throw new Error('image unavailable');
        const buffer = Buffer.from(await upstream.arrayBuffer());
        if (buffer.length > 3_000_000) throw new Error('image too large');
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'private,max-age=3600',
          'X-Content-Type-Options':'nosniff' });
        return res.end(buffer);
      } catch { return json(res, 502, {error:'真实封面暂不可达'}); }
    }
    if (pathname === '/api/health' && HEALTHY.has(req.method)) {
      return json(res, 200, { app: 'StreamVerse Lite', version: APP_VERSION, status: 'ok', port: activePort,
        itemCount: state.items.length, dynamicCount: state.dynamicCount, demoMode: state.demoMode,
        sourceSuccess: state.sources.filter(s => s.ok).length, sourcesFailed: state.sources.filter(s => !s.ok).length,
        proxyConfigured: Boolean(process.env.HTTPS_PROXY), proxySupport: process.env.NODE_USE_ENV_PROXY === '1',
        proxyPort: process.env.SV_PROXY_PORT || null, proxyReady: PROXY_STATUS.ready,
        proxyReason: PROXY_STATUS.reason,
        adultCount: state.items.filter(x => x.category === '成人').length,
        adultRealCount: state.items.filter(x => x.category === '成人' && x.adultType === '真人视频').length,
        adultAnimeCount: state.items.filter(x => x.category === '成人' && x.adultType === '成人动画').length,
        adultAICount: state.items.filter(x => x.category === '成人' && x.adultType === 'AI成人短剧').length,
        adultWithPosterCount: state.items.filter(x => x.category === '成人' && Boolean(x.poster)).length });
    }
    if (pathname === '/api/videos' && HEALTHY.has(req.method)) {
      const { items, lastUpdated, lastAttempt, sources, refreshing, dynamicCount, cachedCount, demoMode } = state;
      return json(res, 200, { items, lastUpdated, lastAttempt, sources, refreshing, dynamicCount, cachedCount, demoMode,
        refreshHours: REFRESH_HOURS, canRefresh: canRefresh(req) });
    }
    if (pathname === '/api/refresh' && req.method === 'POST') {
      if (!canRefresh(req)) return json(res, 403, { error: '无权限。请在本机打开网站，或配置 ADMIN_TOKEN。' });
      if (updating) return json(res, 202, { message: '正在同步中' });
      const scope = new URL(req.url, 'http://localhost').searchParams.get('scope') || 'all';
      if (!feedsForScope(scope).length) return json(res, 400, { error: '未知的刷新分区' });
      refresh(scope).catch(e => console.error('刷新失败:', e));
      return json(res, 202, { message: `已开始同步 ${scope} 分区`, scope });
    }
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Unknown API' });
    if (!HEALTHY.has(req.method)) return json(res, 405, { error: 'Method not allowed' });
    await serveStatic(req, res, pathname);
  });
  const activePort = await choosePort(server);
  console.log(`\n🎬 StreamVerse Lite 已启动：http://127.0.0.1:${activePort}`);
  console.log(`🔎 自检地址：http://127.0.0.1:${activePort}/api/health`);
  console.log(`🌐 代理状态：${PROXY_STATUS.ready ? '已启用 Node fetch 代理支持' : PROXY_STATUS.requested ? '警告！代理变量存在但 Node 不支持代理' : '未启用代理'}`);
  if (PROXY_STATUS.requested) console.log(`    ${PROXY_STATUS.reason}（端口 ${process.env.SV_PROXY_PORT || '未知'}）`);
  console.log(`🔁 每 ${REFRESH_HOURS} 小时自动同步；无需数据库和 npm install。\n`);
  if (!existsSync(MANUAL_PATH)) console.warn('手工内容文件尚未创建:', MANUAL_PATH);
  openBrowser(activePort);
  refresh().catch(e => console.error('首次刷新失败:', e));
  setInterval(() => refresh().catch(e => console.error('定时刷新失败:', e)), INTERVAL).unref();
}
start().catch(e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Close the existing server or change PORT.`);
  } else if (e.code === 'EACCES') {
    console.error(`\nNo permission to listen on port ${PORT}. Choose another port.`);
  } else {
    console.error('\nStartup failed:', e);
  }
  process.exitCode = 1;
});
