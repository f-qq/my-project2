import test from 'node:test';
import assert from 'node:assert/strict';
import { fromBilibili, fromJikan, fromApple, fromArchive, parseYoutubeRSS, mergeItems, validItem } from '../collector.js';

test('B站榜单映射分类：AI短剧优先归入 AI视频，链接指向真实 BV 结构', async () => {
  const records = await fromBilibili(181, '电影', async () => ({ code: 0, data: { list: [
    { bvid: 'BV1aa411c7ab', title: 'AI短剧 奇遇', pic: 'https://img.test/a.jpg', pubdate: 1700000000 },
    { bvid: 'BV1bb411c7ab', title: '精彩短剧 01', pic: 'https://img.test/b.jpg', pubdate: 1700000000 }
  ] } }));
  assert.equal(records[0].category, 'AI视频');
  assert.equal(records[1].category, '短剧');
  assert.equal(records[0].url, 'https://www.bilibili.com/video/BV1aa411c7ab');
});

test('Jikan 优先合法播放来源，再降级预告片或详情', async () => {
  const items = await fromJikan(async () => ({ data: [
    { mal_id: 1, title: 'A', url: 'https://myanimelist.net/anime/1', streaming: [{name:'Crunchyroll',url:'https://www.crunchyroll.com/series/abc'}] },
    { mal_id: 2, title: 'B', url: 'https://myanimelist.net/anime/2', trailer: { youtube_id: 'YE7VzlLtp-4' } },
    { mal_id: 3, title: 'C', url: 'https://myanimelist.net/anime/3' }
  ] }));
  assert.equal(items[0].url, 'https://www.crunchyroll.com/series/abc');
  assert.equal(items[1].action, '播放预告片');
  assert.equal(items[2].action, '查看播放信息');
});

test('Apple 两代 RSS 数据结构支持', async () => {
  const fetchMock = async (url) => {
    if (url.includes('/api/v2/')) throw new Error('v2 unavailable');
    return { feed: { results: [{ id: '42', name: 'Example Movie', url: 'https://tv.apple.com/movie/42', artworkUrl100: 'https://img.test/100x100bb.jpg' }] } };
  };
  const movies = await fromApple('cn', fetchMock);
  assert.equal(movies.length, 1);
  assert.equal(movies[0].region, '国内');
  assert.ok(movies[0].poster.includes('500x750bb'));
});

test('Archive 公共影片页归类', async () => {
  const movies = await fromArchive(async () => ({ response: { docs: [{ identifier: 'the-film', title: 'The Film', year: '1932' }] } }));
  assert.equal(movies[0].url, 'https://archive.org/details/the-film');
});

test('YouTube XML 视频订阅解析及实体转义', () => {
  const xml = `<feed><entry><yt:videoId>YE7VzlLtp-4</yt:videoId><title>A &amp; B</title><published>2026-10-09T01:00:00Z</published></entry></feed>`;
  const items = parseYoutubeRSS(xml, { name: 'Official', region: '海外', category: '视频' });
  assert.equal(items[0].title, 'A & B');
  assert.equal(items[0].url, 'https://www.youtube.com/watch?v=YE7VzlLtp-4');
});

test('去重、拒绝 javascript 链接及错误类别', () => {
  const ok = {id:'same',title:'A',category:'电影',url:'https://example.com/a'};
  const evil = {id:'evil',title:'B',category:'电影',url:'javascript:alert(1)'};
  assert.equal(validItem(evil), false);
  assert.equal(mergeItems([ok], [ok, evil]).length, 1);
});

// 只检验公开内容索引，不在测试中保存任何实际成人影像、露骨标题或封面。
import { fromEporner, feeds } from '../collector.js';

test('官方成人 API 热门与最新榜单通过视频直达 URL 建卡', async () => {
  const seen = [];
  const payload = { videos: [
    { id: 'ABC123', title: 'Sample adult title', default_thumb: { src: 'https://static.eporner.com/example.jpg' }, url: 'https://www.eporner.com/video-ABC123/sample', rate: 4.1, added: '2026-10-09', length: '12:34' },
    { id: 'XYZ567', title: 'Sample 2', url: 'https://www.eporner.com/hd-porn/XYZ567/sample', rate: 3.9, added: '2026-10-08' }
  ] };
  const items = await fromEporner('top-weekly', async url => { seen.push(url); return payload; });
  assert.equal(items.length, 2);
  assert.equal(items[0].category, '成人');
  assert.equal(items[0].url, payload.videos[0].url);
  assert.equal(items[0].poster, 'https://static.eporner.com/example.jpg');
  assert.equal(items[0].year, '2026');
  assert.equal(items[0].title, 'Sample adult title');
  assert.equal(items[0].rating, 8.2);
  assert.match(seen[0], /order=top-weekly/);
  assert.match(seen[0], /query=all/);
});

test('成人 API 拒绝未审核来源域名、可疑类别、非法 id 与不安全协议', async () => {
  const records = await fromEporner('latest', async () => ({videos:[
    { id: 'abc123', title:'regular', url:'javascript:alert(1)' },
    { id: 'abc321', title:'regular', url:'https://evil.example/video-test' },
    { id: 'abc322', title:'underage content', url:'https://www.eporner.com/video-abc322/x' },
    { id: 'ok123', title:'regular', url:'https://www.eporner.com/video-ok123/safe' }
  ]}));
  assert.deepEqual(records.map(x => x.id), ['eporner-ok123']);
  assert.equal(records[0].category, '成人');
  assert.equal(records[0].poster, '');
});

test('成人接口结构异常时明确报错，不把失败伪装成成功', async () => {
  await assert.rejects(() => fromEporner('latest', async () => ({ error: 'blocked' })), /未返回 videos 列表/);
  await assert.rejects(() => fromEporner('unknown', async () => ({})), /Unsupported/);
});

test('成人公开来源默认存在，且随全站更新周期运行', () => {
  assert.ok(feeds.some(feed => feed.id === 'eporner-week'));
  assert.ok(feeds.some(feed => feed.id === 'eporner-new'));
});

import { fromAniList, fromTVMaze, fromTMDB } from '../collector.js';

test('AniList 新增动态趋势榜支持官方播放平台、评分和封面', async () => {
  const items = await fromAniList(async (url, opts) => {
    assert.equal(url, 'https://graphql.anilist.co');
    assert.equal(opts.method, 'POST');
    return { data: { Page: { media: [{
      id: 318, title: { native: '示例热播动漫' }, description: '当前趋势',
      coverImage: { large: 'https://img.example/poster.png' }, seasonYear: 2026,
      externalLinks: [{type:'STREAMING',url:'https://www.crunchyroll.com/watch/abc'}],
      siteUrl: 'https://anilist.co/anime/318', averageScore: 82
    }] } } };
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].category, '动漫');
  assert.equal(items[0].action, '打开播出平台');
  assert.equal(items[0].rating, 8.2);
});

test('TVmaze 将近期播出标为近期上线、不谎称热门', async () => {
  const records = await fromTVMaze(async () => [{
    airdate: '2026-10-08', _embedded: { show: {
      id: 45, name: 'Sample Series', summary: '<p>One example</p>',
      image: { medium: 'https://img.example/series.jpg' },
      url: 'https://www.tvmaze.com/shows/45/sample'
    } }
  }], '2026-10-08');
  assert.equal(records[0].category, '剧集');
  assert.equal(records[0].dataKind, '近期上线');
  assert.equal(records[0].description, 'One example');
});

test('TMDB 有密钥时读取真实榜单分页，缺密钥时明确拒绝', async () => {
  await assert.rejects(() => fromTMDB('movie', async()=> ({}), ''), /TMDB_API_KEY/);
  const pages = [];
  const items = await fromTMDB('movie', async url => {
    pages.push(url);
    return {results:[{id: pages.length, title:'电影样例',original_language:'zh',release_date:'2026-10-09',poster_path:'/foo.jpg'}]};
  }, 'test-key');
  assert.equal(items.length, 2);
  assert.ok(pages[0].includes('api_key=test-key'));
  assert.equal(items[0].region, '国内');
  assert.ok(items[0].poster.includes('image.tmdb.org'));
});

test('新版聚合支持剧集分类，防止示例与实时榜单混淆', () => {
  assert.equal(validItem({id:'tv-123',title:'剧集示例',url:'https://www.tvmaze.com/shows/123',category:'剧集'}), true);
  assert.ok(feeds.some(f => f.id === 'anilist'));
  assert.ok(feeds.some(f => f.id === 'tvmaze'));
});
