import test from 'node:test';
import assert from 'node:assert/strict';
import { fromEporner, fromAdultAI, fromHuangguo, fromAniListAdult, platformName, mergeItems, feeds } from '../collector.js';
import { feedsForScope } from '../server-config.js';

test('真实来源平台字段不能随便冒充 X 和 OnlyFans', () => {
  assert.equal(platformName('https://www.eporner.com/video-ABC123/foo'), 'Eporner');
  assert.equal(platformName('https://x.com/user/status/123'), 'X');
  assert.equal(platformName('https://onlyfans.com/creator'), 'OnlyFans');
  assert.equal(platformName('https://www.eporner.com/watch/abc', 'OnlyFans'), 'Eporner');
});

test('AI成人专区只接受真实标题中标记 AI 的候选条目', async () => {
  const list = await fromAdultAI(async () => ({videos:[
    {id:'ABC123',title:'AI generated short film',url:'https://www.eporner.com/video-ABC123/a',default_thumb:{src:'https://static.eporner.com/a.jpg'}},
    {id:'XYZ789',title:'Ordinary short film',url:'https://www.eporner.com/video-XYZ789/a'}
  ]}));
  assert.equal(list.length, 1);
  assert.equal(mergeItems(list)[0].adultType, 'AI成人短剧');
  assert.equal(mergeItems(list)[0].platform, 'Eporner');
  assert.equal(list[0].title,'AI generated short film');
  assert.equal(list[0].poster,'https://static.eporner.com/a.jpg');
});

test('Huangguo 仅导入确实存在的详情页、标题及封面', async () => {
  const feed = await fromHuangguo(async url => url.endsWith('/en/library/')
    ? '<a href="/en/detail/113077/">Example work</a>'
    : `<html><head><meta property="og:title" content="Verified AI short drama"/><meta property="og:image" content="https://huangguodrama.ai/covers/real.jpg"/></head></html>`);
  assert.equal(feed.length,1);
  assert.equal(feed[0].title,'Verified AI short drama');
  assert.equal(feed[0].poster,'https://huangguodrama.ai/covers/real.jpg');
  assert.equal(feed[0].url,'https://huangguodrama.ai/en/detail/113077/');
  assert.equal(mergeItems(feed)[0].platform,'Huangguo Drama');
});

test('成人来源必须实际收录 AI 的两个源', () => {
  assert.ok(feeds.some(f => f.id === 'eporner-ai'));
  assert.ok(feeds.some(f => f.id === 'huangguo-ai'));
});

test('分区刷新不会影响其他来源，且筛选未知来源会拒绝', () => {
  assert.ok(feedsForScope('AI成人短剧').every(x=>['eporner-ai','huangguo-ai'].includes(x.id)));
  assert.ok(feedsForScope('电影').every(x=>!x.id.includes('eporner')));
  assert.deepEqual(feedsForScope('anything-that-does-not-exist'),[]);
});
