import { fromEporner, fromAniListAdult, fromJikanAdult, fromAdultAI, fromHuangguo } from './collector.js';
import { initializeProxy } from './proxy-init.js';
const proxyStatus = initializeProxy();
const blank = v => v ? '已配置' : '未配置';
console.log('\nStreamVerse Lite 成人专区网络诊断');
console.log('Node:', process.version);
console.log('HTTP_PROXY:', blank(process.env.HTTP_PROXY));
console.log('HTTPS_PROXY:', blank(process.env.HTTPS_PROXY));
console.log('NODE_USE_ENV_PROXY:', process.env.NODE_USE_ENV_PROXY || '(未启用)');
console.log('Proxy mode:', proxyStatus.reason);
console.log('Proxy port:', process.env.SV_PROXY_PORT || '(未指定)');
if (proxyStatus.requested && !proxyStatus.ready) console.warn('警告：已设置代理环境变量，但当前 Node 无法应用它，可能仍使用直连。');
console.log('\n正在测试实际在线接口，单项最长约 15 秒...\n');
for (const [name, collect] of [
  ['Eporner 本周真人榜', () => fromEporner('top-weekly')],
  ['AniList 成人动画备用源', () => fromAniListAdult()],
  ['Jikan 成人动画备用源', () => fromJikanAdult()],
  ['Eporner AI 关键词检索', () => fromAdultAI()],
  ['Huangguo Drama AI短剧公开目录', () => fromHuangguo()]
]) {
  try {
    const items = await collect();
    console.log(`✅ ${name}: 获取 ${items.length} 条有效数据`);
    if (!items.length) console.log('   警告：成功返回，但过滤后为空。');
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
  }
}
console.log('\n检查完毕。以上只验证网络及元数据，不下载/存储任何视频。');
