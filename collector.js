/**
 * 不需要 API key 的影视内容收集器。失败的单个源不会影响其它源。
 * 站外跳转，不代理付费视频，不下载影片文件。
 */
const AGENT = 'Mozilla/5.0 (compatible; StreamVerseLite/1.0; +https://example.org)';

export async function fetchText(url, { timeout = 12000, headers = {}, method = 'GET', body, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        signal: controller.signal, method, ...(body ? { body } : {}),
        headers: { 'User-Agent': AGENT, Accept: '*/*', ...headers }
      });
    } catch (error) {
      const code = error?.cause?.code || error?.code || '';
      const reason = error?.cause?.message || error?.message || '未知错误';
      // 让用户能区分 DNS、代理、TLS、超时与网站拒绝访问。
      const host = new URL(url).hostname;
      throw new Error(`${host}: ${code ? code + ' · ' : ''}${reason}`);
    }
    if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
    const text = await response.text();
    if (/^\s*</.test(text) && /cloudflare|captcha|access denied|just a moment/i.test(text.slice(0, 1000))) {
      throw new Error(`${new URL(url).hostname}: 返回了访问验证页，无法解析为 API 数据`);
    }
    return text;
  } finally { clearTimeout(timer); }
}

export async function fetchJSON(url, options = {}) {
  const raw = await fetchText(url, options);
  return JSON.parse(raw);
}

const clean = (input, max = 350) => String(input ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const https = (input) => {
  try {
    const u = new URL(String(input));
    return ['http:', 'https:'].includes(u.protocol) ? u.toString().replace(/^http:/, 'https:') : '';
  } catch { return ''; }
};

export function validItem(item) {
  return Boolean(item && item.id && item.title && https(item.url) && ['电影', '剧集', '短剧', '动漫', 'AI视频', '纪录片', '视频', '成人'].includes(item.category));
}

export function platformName(url, source = '') {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'eporner.com' || host.endsWith('.eporner.com')) return 'Eporner';
    if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com') return 'X';
    if (host === 'onlyfans.com' || host.endsWith('.onlyfans.com')) return 'OnlyFans';
    if (host === 'pornhub.com' || host.endsWith('.pornhub.com')) return 'Pornhub';
    if (host === 'xvideos.com' || host.endsWith('.xvideos.com')) return 'XVideos';
    if (host === 'huangguodrama.ai') return 'Huangguo Drama';
    if (host === 'anilist.co') return 'AniList';
    if (host === 'myanimelist.net') return 'MyAnimeList';
    if (host.endsWith('youtube.com') || host === 'youtu.be') return 'YouTube';
    if (host.endsWith('bilibili.com')) return '哔哩哔哩';
    if (host.endsWith('tv.apple.com')) return 'Apple TV';
  } catch {}
  return clean(source, 45) || '其他来源';
}

export function normalize(item) {
  return {
    id: clean(item.id, 100), title: clean(item.title, 170), description: clean(item.description, 280),
    category: item.category, region: item.region === '国内' ? '国内' : '海外',
    source: clean(item.source, 45), platform: platformName(item.url, item.source), poster: https(item.poster), url: https(item.url),
    action: clean(item.action || '前往观看', 24), year: clean(item.year, 12),
    rating: item.rating && Number.isFinite(+item.rating) ? Number(item.rating) : null,
    tags: Array.isArray(item.tags) ? item.tags.map(t => clean(t, 20)).slice(0, 5) : [],
    featured: Boolean(item.featured), publishedAt: item.publishedAt || '',
    adultType: item.category === '成人' ? (['成人动画', 'AI成人短剧'].includes(item.adultType) ? item.adultType : '真人视频') : '',
    dataKind: ['榜单', '近期上线', '频道更新', '示例', '关键词检索'].includes(item.dataKind) ? item.dataKind : '榜单',
    trend: Number.isFinite(Number(item.trend)) ? Number(item.trend) : 0
  };
}

export async function fromBilibili(rid, category = '电影', fetcher = fetchJSON) {
  const payload = await fetcher(`https://api.bilibili.com/x/web-interface/ranking/v2?rid=${rid}&type=all`, {
    timeout: 10000,
    headers: { Referer: 'https://www.bilibili.com/', Accept: 'application/json' }
  });
  if (payload.code !== 0 || !Array.isArray(payload.data?.list)) throw new Error(`B站接口: ${payload.message || '无数据'}`);
  return payload.data.list.slice(0, 35).map((v, index) => {
    const title = clean(v.title, 170);
    const ai = /(?:^|[^a-z])AI(?:[^a-z]|$)|AIGC|人工智能|AI短剧|AI漫剧|可灵|即梦|Sora|Runway|生成式/i.test(title);
    const drama = /短剧|微剧|短片|迷你剧|漫剧|小剧场/i.test(title);
    const documentary = /纪录片|纪实|自然纪录/i.test(title);
    const mappedCategory = ai ? 'AI视频' : drama ? '短剧' : documentary ? '纪录片' : category;
    return {
      id: `bili-${v.bvid}`, title, description: clean(v.desc, 180),
      category: mappedCategory, region: '国内', source: '哔哩哔哩',
      poster: v.pic, url: v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : '',
      action: '站外播放', year: v.pubdate ? String(new Date(v.pubdate * 1000).getFullYear()) : '',
      tags: [v.tname || category, ai ? 'AI创作' : '热门'],
      trend: 150 - index, publishedAt: v.pubdate ? new Date(v.pubdate * 1000).toISOString() : ''
    };
  }).filter(validItem);
}

export async function fromJikan(fetcher = fetchJSON) {
  const payload = await fetcher('https://api.jikan.moe/v4/top/anime?filter=airing&limit=20&sfw=true', { timeout: 13000 });
  return (payload.data || []).filter(a => a?.mal_id && a?.title).map((anime, index) => {
    const platform = (anime.streaming || []).find(s => https(s.url));
    const trailer = https(anime.trailer?.url || anime.trailer?.youtube_id && `https://www.youtube.com/watch?v=${anime.trailer.youtube_id}`);
    const url = platform ? https(platform.url) : (trailer || https(anime.url));
    return {
      id: `anime-${anime.mal_id}`, title: anime.title_english || anime.title,
      description: anime.synopsis || '', category: '动漫', region: '海外', source: 'MyAnimeList / Jikan',
      poster: anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url,
      url, action: platform ? `到 ${clean(platform.name, 14)} 观看` : trailer ? '播放预告片' : '查看播放信息',
      year: anime.year || anime.aired?.from?.slice(0, 4) || '', rating: anime.score,
      tags: ['当前热番', ...(anime.genres || []).slice(0, 2).map(g => g.name)], trend: 130 - index
    };
  }).filter(validItem);
}

export async function fromApple(country, fetcher = fetchJSON) {
  const urls = [
    `https://itunes.apple.com/${country}/rss/topmovies/limit=50/json`,
    `https://rss.applemarketingtools.com/api/v2/${country}/movies/top-movies/25/movies.json`,
    `https://rss.itunes.apple.com/api/v1/${country}/movies/top-movies/all/25/json`
  ];
  let payload, lastError;
  for (const endpoint of urls) {
    try {
      payload = await fetcher(endpoint, { timeout: 10000 });
      if ((Array.isArray(payload?.feed?.results) && payload.feed.results.length) || payload?.feed?.entry) break;
      throw new Error('空榜单');
    } catch (e) { lastError = e; }
  }
  const movies = Array.isArray(payload?.feed?.results) ? payload.feed.results :
    (Array.isArray(payload?.feed?.entry) ? payload.feed.entry.map(e => ({
      id: e.id?.attributes?.['im:id'] || e.id?.label, name: e['im:name']?.label,
      url: e.link?.[0]?.attributes?.href || e.link?.attributes?.href || e.id?.label,
      artworkUrl100: e['im:image']?.at(-1)?.label, artistName: e['im:artist']?.label,
      releaseDate: e['im:releaseDate']?.label, genres: [{name: e.category?.attributes?.label || '电影'}]
    })) : []);
  if (!movies.length) throw lastError || new Error('无电影数据');
  return movies.map((movie, index) => ({
    id: `apple-${country}-${movie.id}`, title: movie.name, description: movie.artistName || 'Apple TV 电影榜单',
    category: '电影', region: country === 'cn' ? '国内' : '海外', source: `Apple 电影榜 · ${country.toUpperCase()}`,
    poster: (movie.artworkUrl100 || movie.artworkUrl60 || '').replace(/\d+x\d+bb/, '500x750bb'),
    url: movie.url, action: '查看官方观看/购买渠道', year: (movie.releaseDate || '').slice(0, 4),
    tags: [movie.genres?.[0]?.name || '电影', '榜单'], trend: 120 - index
  })).filter(validItem);
}

export async function fromArchive(fetcher = fetchJSON) {
  const u = new URL('https://archive.org/advancedsearch.php');
  u.searchParams.set('q', 'collection:feature_films AND mediatype:movies');
  ['identifier', 'title', 'year', 'downloads', 'description'].forEach(s => u.searchParams.append('fl[]', s));
  u.searchParams.append('sort[]', 'downloads desc');
  u.searchParams.set('rows', '16'); u.searchParams.set('output', 'json');
  const json = await fetcher(u.toString(), { timeout: 14000 });
  return (json.response?.docs || []).map((v, index) => ({
    id: `archive-${v.identifier}`, title: Array.isArray(v.title) ? v.title[0] : v.title,
    description: 'Internet Archive 影像资料；观看与版权状态请以馆藏页为准。',
    category: '电影', region: '海外', source: 'Internet Archive',
    poster: `https://archive.org/services/img/${encodeURIComponent(v.identifier)}`,
    url: `https://archive.org/details/${encodeURIComponent(v.identifier)}`,
    action: '打开公开视频页面', year: Array.isArray(v.year) ? v.year[0] : v.year,
    tags: ['影视资料', '可在线观看'], trend: 40 - index, dataKind: '频道更新'
  })).filter(validItem);
}

export function parseYoutubeRSS(xml, config) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  const tag = (body, name) => body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`))?.[1] || '';
  const decode = s => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return entries.slice(0, 14).map(([, entry], index) => {
    const id = tag(entry, 'yt:videoId');
    const title = decode(tag(entry, 'title'));
    return {
      id: `yt-${id}`, title, description: `${config.name} 官方频道近期发布，按原站内容提供观看。`,
      category: /short film|短片|短剧|mini drama/i.test(title) ? '短剧' : config.category,
      region: config.region, source: config.name,
      poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${id}`, action: 'YouTube 播放',
      year: tag(entry, 'published').slice(0, 4), publishedAt: tag(entry, 'published'),
      tags: ['官方频道', '近期更新'], trend: 105 - index, dataKind: '频道更新'
    };
  }).filter(validItem);
}

export async function fromYoutube(config, fetcher = fetchText) {
  const xml = await fetcher(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(config.id)}`, { timeout: 10000 });
  if (!xml.includes('<feed')) throw new Error('视频订阅源格式错误');
  return parseYoutubeRSS(xml, config);
}

/**
 * 18+ 官方公开 API，只采集元数据与对应原站观看页面。
 * 不抓取/代理视频，不输出可能露骨的标题、预览图、标签。
 * 来源列表仅在访客自我确认成年之后在前端显示。
 */
const UNSAFE_ADULT_TITLE = /(?:\b(?:child|children|underage|minor|kid|preteen|lolita|rape|raped|non-consensual|incest|beastiality|bestiality)\b|儿童色情|未成年|幼女|幼童|强奸|乱伦|兽交)/i;

/** 直接使用官方 API 的真实标题、封面、观看链接；不生成假的编号影片。 */
export async function fromEporner(order = 'top-weekly', fetcher = fetchJSON, options = {}) {
  const allowed = new Set(['top-weekly', 'latest', 'top-monthly']);
  if (!allowed.has(order)) throw new Error('Unsupported adult feed sort order');
  const isAI = options.ai === true;
  const params = new URLSearchParams({
    query: isAI ? 'AI generated' : 'all', per_page: '48', page: '1', thumbsize: 'big',
    order, gay: '1', lq: '0', format: 'json'
  });
  const json = await fetcher(`https://www.eporner.com/api/v2/video/search/?${params}`, { timeout: 16000 });
  if (!Array.isArray(json?.videos)) throw new Error('Eporner API 未返回 videos 列表');
  const listName = order === 'top-weekly' ? '本周热门' : order === 'latest' ? '最新发布' : '本月热门';
  const accepted = json.videos.filter(v => {
    if (!v?.id || !/^[a-zA-Z0-9_-]{3,48}$/.test(String(v.id))) return false;
    if (!clean(v.title) || UNSAFE_ADULT_TITLE.test(String(v.title))) return false;
    try {
      const u = new URL(String(v.url || ''));
      if (u.protocol !== 'https:' || !['eporner.com', 'www.eporner.com'].includes(u.hostname)) return false;
      if (!u.pathname.startsWith('/video-') && !u.pathname.startsWith('/hd-porn/')) return false;
    } catch { return false; }
    if (isAI) {
      // 仅认为该视频标题标注了 AI 创作，不将标签匹配等同于实际鉴定。
      const label = [v.title, ...(Array.isArray(v.tags) ? v.tags : [])].join(' ');
      return /\bAI\b|AI.generated|artificial intelligence|synthetic|人工智能|AI短剧|AI生成/i.test(label);
    }
    return true;
  });
  if (json.videos.length && !accepted.length && !isAI) {
    throw new Error(`API 返回 ${json.videos.length} 条，但链接或安全校验全部未通过`);
  }
  return accepted.slice(0, 40).map((v, index) => {
    const publishedAt = /^\d{4}-\d{2}-\d{2}/.test(String(v.added || '')) ? String(v.added).slice(0, 10) : '';
    const duration = typeof v.length === 'string' && /^\d{1,3}:\d\d(?::\d\d)?$/.test(v.length) ? v.length : '';
    const rate = Number(v.rate);
    const thumbnails = [v.default_thumb?.src, ...(Array.isArray(v.thumbs) ? v.thumbs.map(x => x.src) : [])];
    const cover = thumbnails.map(https).find(Boolean) || '';
    return {
      id: `eporner-${v.id}`, title: clean(v.title, 170),
      description: isAI ? '由原站标题或标签匹配到 AI 关键词；是否真正由 AI 生成尚未独立核验。' :
        `Eporner ${listName}公开条目${duration ? ` · ${duration}` : ''}`,
      category: '成人', region: '海外', source: 'Eporner', poster: cover,
      url: v.url, action: '前往 Eporner 观看', year: publishedAt.slice(0, 4),
      publishedAt, rating: Number.isFinite(rate) && rate >= 0 && rate <= 5 ? rate * 2 : null,
      tags: ['18+', isAI ? 'AI关键词匹配' : '真人视频', listName, ...(duration ? [duration] : [])],
      adultType: isAI ? 'AI成人短剧' : '真人视频',
      trend: isAI ? 160 - index : order === 'top-weekly' ? 220 - index : 180 - index,
      dataKind: isAI ? '关键词检索' : '榜单'
    };
  }).filter(validItem);
}

export async function fromAdultAI(fetcher = fetchJSON) {
  return fromEporner('latest', fetcher, { ai: true });
}

/**
 * 备用来源：AniList 明确标为 18+ 的成人动画目录，属于动漫资料而非真人视频。
 * AniList 仅提供资料/平台链接，不能保证存在直接在线播放链接。
 * 不采集缩略图、露骨标题、说明或标签；此来源不冒充真人影片或视频直链。
 */
export async function fromAniListAdult(fetcher = fetchJSON) {
  const query = `query { Page(page: 1, perPage: 25) { media(type: ANIME, isAdult: true, sort: POPULARITY_DESC) { id isAdult siteUrl seasonYear popularity externalLinks { site url type } streamingEpisodes { url site } title { english romaji native } coverImage { extraLarge large medium } } } }`;
  const payload = await fetcher('https://graphql.anilist.co', {
    timeout: 15000, method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query })
  });
  if (payload.errors?.length) throw new Error(`AniList 成人目录接口错误: ${clean(payload.errors[0].message, 120)}`);
  const media = payload?.data?.Page?.media;
  if (!Array.isArray(media)) throw new Error('AniList 成人目录未返回有效媒体列表');
  return media.filter(v => v && v.isAdult === true && Number.isSafeInteger(v.id)).map((v, i) => {
    const episode = (v.streamingEpisodes || []).find(x => https(x.url));
    const platform = (v.externalLinks || []).find(x => x.type === 'STREAMING' && https(x.url));
    const watchUrl = episode?.url || platform?.url;
    const detail = https(v.siteUrl);
    return {
      id: `anilist-adult-${v.id}`, title: clean(v.title?.english || v.title?.romaji || v.title?.native, 170),
      description: 'AniList 标记为面向 18 岁以上观众的成人动画。不是 Eporner 真人影片。',
      category: '成人', adultType: '成人动画', region: '海外', source: 'AniList / 18+ 动画目录',
      poster: v.coverImage?.large || v.coverImage?.extraLarge || v.coverImage?.medium || '', url: https(watchUrl) || detail,
      action: watchUrl ? '打开播出平台' : '查看动画详情及观看渠道',
      year: v.seasonYear || '', tags: ['18+', '成人动画', '人气目录'],
      trend: 115 - i, dataKind: '榜单'
    };
  }).filter(validItem);
}

/** 另一独立备用目录：Jikan / MyAnimeList，限制为 Hentai 分类（genre 12）。 */
export async function fromJikanAdult(fetcher = fetchJSON) {
  const payload = await fetcher('https://api.jikan.moe/v4/anime?genres=12&order_by=popularity&sort=asc&limit=25', { timeout: 15000 });
  if (!Array.isArray(payload.data)) throw new Error('Jikan 成人动画目录格式异常');
  return payload.data.filter(a => a?.mal_id && (a.genres || []).some(g => Number(g?.mal_id) === 12))
    .map((a, index) => {
      const platform = (a.streaming || []).find(x => https(x.url));
      return {
        id: `jikan-adult-${a.mal_id}`, title: clean(a.title_english || a.title, 170),
        description: 'MyAnimeList 标为成人向的动画作品目录。不会播放视频；可能需要到官方播放平台观看。',
        category: '成人', adultType: '成人动画', region: '海外', source: 'Jikan / 成人动画目录',
        poster: a.images?.webp?.large_image_url || a.images?.jpg?.large_image_url || '', url: platform?.url || a.url,
        action: platform ? '前往播出平台' : '查看动画详情及观看渠道',
        year: a.year || '', rating: a.score, tags: ['18+', '成人动画', '人气目录'],
        trend: 75 - index
      };
    }).filter(validItem);
}

/** Huangguo Drama 的公开 AI 短剧目录：只使用其站内实际链接和详情页元数据。
 * 非官方 API；网站改版时可能无法解析，会明确显示失败而不是造数。
 */
export async function fromHuangguo(fetcher = fetchText) {
  const origin = 'https://huangguodrama.ai';
  const index = await fetcher(`${origin}/en/library/`, {timeout:14000});
  const ids = [...new Set([...index.matchAll(/\/en\/detail\/(\d{3,12})(?=\/|["'?])/g)]
    .map(x => x[1]))].slice(0, 12);
  if (!ids.length) throw new Error('Huangguo 页面结构发生变化，未获取到作品详情链接');
  const meta = (html, prop) => {
    const safe = prop.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const tag = html.match(new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${safe}["'][^>]*>`, 'i'))?.[0] ||
      html.match(new RegExp(`<meta\\s+[^>]*content=["'][^"']*["'][^>]*(?:property|name)=["']${safe}["'][^>]*>`, 'i'))?.[0] || '';
    return tag.match(/content=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, '&') || '';
  };
  const items = await Promise.all(ids.map(async (id, i) => {
    try {
      const url = `${origin}/en/detail/${id}/`;
      const html = await fetcher(url, {timeout:9500});
      const title = meta(html, 'og:title') || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g,'') || '';
      const poster = meta(html, 'og:image') || html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i)?.[1] || '';
      const absolutePoster = poster ? https(new URL(poster,origin).toString()) : '';
      return { id:`huangguo-${id}`, title:clean(title,170), poster:absolutePoster,
        url, category:'成人', adultType:'AI成人短剧', region:'海外', source:'Huangguo Drama',
        description:'18+ AI 短剧官方目录；具体已发布的剧集、时长和播放权限以原站为准。',
        tags:['18+','AI 短剧','官方作品'], action:'前往作品页观看', trend:135-i, dataKind:'近期上线' };
    } catch { return null; }
  }));
  const records = items.filter(validItem);
  if (!records.length) throw new Error('Huangguo 详情页加载或解析失败');
  return records;
}

/** 免费、无需密钥：TVmaze 的近日播放表，不冒充热度排行榜。 */
export async function fromTVMaze(fetcher = fetchJSON, date = new Date().toISOString().slice(0, 10)) {
  const list = await fetcher(`https://api.tvmaze.com/schedule/web?date=${date}`, { timeout: 12000 });
  if (!Array.isArray(list)) throw new Error('TVmaze 播出表格式错误');
  const seen = new Set();
  return list.map((episode, index) => {
    const show = episode._embedded?.show || episode.show || {};
    if (!show.id || seen.has(show.id)) return null;
    seen.add(show.id);
    return {
      id: `tvmaze-${show.id}`, title: show.name, description: clean(show.summary || '', 200),
      category: '剧集', region: '海外', source: 'TVmaze / 本周上线',
      poster: show.image?.medium || show.image?.original || '',
      url: show.officialSite || show.url, action: show.officialSite ? '打开官方观看渠道' : '查看播出详情',
      year: (show.premiered || '').slice(0, 4), publishedAt: episode.airdate || date,
      tags: [show.type || '剧集', '近期上线'], trend: 48 - index, dataKind: '近期上线'
    };
  }).filter(validItem).slice(0, 40);
}

/** 免费、无需密钥：AniList 当前热门趋势动漫。 */
export async function fromAniList(fetcher = fetchJSON) {
  const query = `query ($page: Int) { Page(page: $page, perPage: 35) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { id title { english romaji native } description(asHtml: false) coverImage { extraLarge large } siteUrl seasonYear popularity trending averageScore externalLinks { site url type } trailer { site id } } } }`;
  const payload = await fetcher('https://graphql.anilist.co', {
    timeout: 15000, method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
    body: JSON.stringify({ query, variables: { page: 1 } })
  });
  const entries = payload?.data?.Page?.media;
  if (!Array.isArray(entries)) throw new Error('AniList 未返回排行榜');
  return entries.map((anime, index) => {
    const legalPlatform = (anime.externalLinks || []).find(x => x.type === 'STREAMING' && https(x.url));
    const trailer = anime.trailer?.site === 'youtube' && /^[a-zA-Z0-9_-]{11}$/.test(anime.trailer.id || '')
      ? `https://www.youtube.com/watch?v=${anime.trailer.id}` : '';
    return {
      id: `anilist-${anime.id}`, title: anime.title?.native || anime.title?.english || anime.title?.romaji,
      description: anime.description || '', category: '动漫', region: '海外', source: 'AniList / 动漫趋势',
      poster: anime.coverImage?.extraLarge || anime.coverImage?.large,
      url: legalPlatform?.url || trailer || anime.siteUrl,
      action: legalPlatform ? '打开播出平台' : trailer ? '播放预告片' : '查看播出信息',
      year: anime.seasonYear || '', rating: anime.averageScore ? anime.averageScore / 10 : null,
      tags: ['动漫趋势', `人气 ${anime.popularity || 0}`], trend: 190 - index,
      dataKind: '榜单'
    };
  }).filter(validItem);
}

/** 可选：官方 TMDB 热门电影/剧集。需用户自行免费申请 TMDB Key。 */
export async function fromTMDB(kind = 'movie', fetcher = fetchJSON, apiKey = process.env.TMDB_API_KEY || '') {
  if (!apiKey) throw new Error('未设置 TMDB_API_KEY（选填）');
  if (!['movie', 'tv'].includes(kind)) throw new Error('Unknown TMDB type');
  const list = [];
  for (const page of [1, 2]) {
    const data = await fetcher(`https://api.themoviedb.org/3/trending/${kind}/week?language=zh-CN&page=${page}&api_key=${encodeURIComponent(apiKey)}`, {timeout:12000});
    if (!Array.isArray(data.results)) throw new Error('TMDB 热门列表异常');
    list.push(...data.results);
  }
  return list.map((movie,index) => ({
    id: `tmdb-${kind}-${movie.id}`, title: movie.title || movie.name || movie.original_title || movie.original_name,
    description: movie.overview || '', category: kind === 'movie' ? '电影' : '剧集',
    region: movie.original_language === 'zh' ? '国内' : '海外', source: `TMDB / 本周热门${kind === 'movie' ? '电影' : '剧集'}`,
    poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : '',
    url: `https://www.themoviedb.org/${kind}/${movie.id}?language=zh-CN`,
    action: '查看电影详情与播放渠道',
    year: (movie.release_date || movie.first_air_date || '').slice(0,4),
    rating: movie.vote_average, tags: ['本周热门', 'TMDB'], trend: 250 - index, dataKind:'榜单'
  })).filter(validItem);
}

export const feeds = [
  ...(process.env.TMDB_API_KEY ? [
    { id: 'tmdb-movies', name: 'TMDB 本周热门电影', collect: () => fromTMDB('movie') },
    { id: 'tmdb-tv', name: 'TMDB 本周热门剧集', collect: () => fromTMDB('tv') }
  ] : []),
  { id: 'anilist', name: 'AniList 动漫趋势榜', collect: () => fromAniList() },
  { id: 'tvmaze', name: 'TVmaze 近日上线剧集', collect: () => fromTVMaze() },
  { id: 'bili-film', name: 'B站影视榜', collect: () => fromBilibili(181, '电影') },
  { id: 'bili-anime', name: 'B站动画榜', collect: () => fromBilibili(1, '动漫') },
  { id: 'apple-us', name: '海外电影榜', collect: () => fromApple('us') },
  { id: 'apple-cn', name: '国内电影榜', collect: () => fromApple('cn') },
  { id: 'jikan', name: '海外热番', collect: () => fromJikan() },
  { id: 'youtube-netflix', name: 'Netflix 官方新视频', collect: () => fromYoutube({ id: 'UCWOA1ZGywLbqmigxE4Qlvuw', name: 'Netflix YouTube', category: '视频', region: '海外' }) },
  { id: 'archive', name: '开放影像', collect: () => fromArchive() },
  // 默认自动搜集两个公开成人榜单；可通过 ADULT_FEEDS=0 禁用。
  ...(process.env.ADULT_FEEDS === '0' ? [] : [
    { id: 'eporner-week', name: 'Eporner 真人本周热门 (18+)', collect: () => fromEporner('top-weekly') },
    { id: 'eporner-new', name: 'Eporner 真人最新发布 (18+)', collect: () => fromEporner('latest') },
    { id: 'eporner-ai', name: 'Eporner AI成人短片检索（候选）', collect: () => fromAdultAI() },
    { id: 'huangguo-ai', name: 'Huangguo Drama 公开 AI 短剧目录', collect: () => fromHuangguo() },
    { id: 'anilist-adult', name: 'AniList 成人动画目录 (18+)', collect: () => fromAniListAdult() },
    { id: 'jikan-adult', name: 'Jikan 成人动画目录 (18+)', collect: () => fromJikanAdult() }
  ])
];

export function mergeItems(...groups) {
  const byId = new Map();
  for (const group of groups) {
    for (const raw of group) {
      if (!validItem(raw)) continue;
      const item = normalize(raw);
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}
