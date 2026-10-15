import test from 'node:test';
import assert from 'node:assert/strict';
import { fromEporner, fromAniListAdult, fromJikanAdult, mergeItems, feeds, fetchText } from '../collector.js';

test('Eporner 合法视频保留成人类型，区分动画/真人', async () => {
  const items = await fromEporner('top-weekly', async () => ({ videos: [
    { id: 'ABC123', title: 'Safe metadata', url: 'https://www.eporner.com/video-ABC123/sample' }
  ] }));
  assert.equal(items[0].adultType, '真人视频');
  assert.equal(mergeItems(items)[0].adultType, '真人视频');
});

test('Eporner 被结构过滤为 0 时给出准确失败原因', async () => {
  await assert.rejects(() => fromEporner('latest', async () => ({ videos: [
    { id: '1234', url: 'https://bad.example/video-1234/foo' }
  ] })), /链接或安全校验全部未通过/);
});

test('AniList 18+ 查询必须明确 isAdult: true 且使用真实封面和标题', async () => {
  const items = await fromAniListAdult(async (url, opts) => {
    assert.equal(url, 'https://graphql.anilist.co');
    assert.match(JSON.parse(opts.body).query, /isAdult: true/);
    return { data: { Page: { media: [
      { id: 1001, isAdult: true, title:{english:'Example Adult Animation'}, coverImage:{large:'https://s4.anilist.co/img.jpg'}, seasonYear: 2025, siteUrl: 'https://anilist.co/anime/1001',
        externalLinks: [{ type: 'STREAMING', site:'Example legal platform', url:'https://stream.example/watch/1' }] },
      { id: 1002, isAdult: false, siteUrl: 'https://anilist.co/anime/1002' }
    ] } } };
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].poster, 'https://s4.anilist.co/img.jpg');
  assert.equal(items[0].category, '成人');
  assert.equal(items[0].adultType, '成人动画');
  assert.equal(items[0].action, '打开播出平台');
  assert.equal(items[0].url, 'https://stream.example/watch/1');
  assert.equal(mergeItems(items)[0].adultType, '成人动画');
});

test('AniList 无观看地址时应当标注介绍页，而非冒充可直接播放', async () => {
  const items = await fromAniListAdult(async () => ({data:{Page:{media:[
    { id:1234,isAdult:true,title:{romaji:'Example series'},siteUrl:'https://anilist.co/anime/1234'}
  ]}}}));
  assert.equal(items[0].action, '查看动画详情及观看渠道');
});

test('Jikan 查询并仅接受 genre 12 的成人动画', async () => {
  const list = await fromJikanAdult(async url => {
    assert.match(url, /genres=12/);
    return {data:[
      {mal_id:1, title:'Example Adult Anime', url:'https://myanimelist.net/anime/1',genres:[{mal_id:12,name:'Hentai'}]},
      {mal_id:2, url:'https://myanimelist.net/anime/2',genres:[{mal_id:1,name:'Action'}]}
    ]};
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].poster, '');
  assert.equal(list[0].adultType, '成人动画');
});

test('三平台四路成人来源被加入采集清单', () => {
  for (const id of ['eporner-week', 'eporner-new', 'anilist-adult', 'jikan-adult'])
    assert.ok(feeds.some(f => f.id === id));
});

test('网络错误展示真实失败的域名和原因', async () => {
  await assert.rejects(() => fetchText('https://api.test.example/foo', {fetchImpl: async ()=> {
    const err=new Error('fetch failed'); err.cause={code:'ENOTFOUND', message:'DNS lookup failed'};
    throw err;
  }}), /api\.test\.example: ENOTFOUND · DNS lookup failed/);
});
