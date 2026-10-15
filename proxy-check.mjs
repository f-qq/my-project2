/**
 * v2rayN HTTP / mixed port preflight (dependency-free).
 * Checks real HTTP CONNECT semantics, not merely whether a TCP port is open.
 * stdout is machine-readable when called with --choose; diagnostics go to stderr.
 */
import net from 'node:net';

export async function probeHttpConnect(port, { timeoutMs = 5000, host = 'www.example.com' } = {}) {
  if (!Number.isSafeInteger(Number(port)) || +port < 1 || +port > 65535) {
    return { port, ok: false, kind: 'invalid', detail: '端口必须是 1–65535 的整数' };
  }
  return await new Promise(resolve => {
    let done = false;
    const socket = net.connect({ host: '127.0.0.1', port: +port });
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ port: +port, ...result });
    };
    const timer = setTimeout(() => finish({ok: false, kind: 'timeout', detail: '代理没有及时回应 HTTP CONNECT 请求'}), timeoutMs);
    let collected = '';
    socket.on('connect', () => socket.write(
      `CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\nProxy-Connection: close\r\n\r\n`
    ));
    socket.on('data', chunk => {
      collected += chunk.toString('latin1');
      if (collected.length > 8192) return finish({ ok: false, kind: 'invalid', detail: '代理响应格式异常' });
      if (collected.includes('\r\n')) {
        const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(collected.split('\r\n')[0]);
        if (!status) return finish({ ok:false, kind:'non-http', detail:'不是 HTTP CONNECT 响应，可能为纯 SOCKS5 端口' });
        const code = Number(status[1]);
        finish({ ok: code === 200, kind: 'http', status: code,
          detail: code === 200 ? 'HTTP CONNECT 已建立' : `HTTP 代理可响应，但目标连接返回 ${code}` });
      }
    });
    socket.on('error', e => finish({ ok:false, kind:'socket', detail:`${e.code || 'SOCKET'} ${e.message}` }));
    socket.on('end', () => finish({ ok:false, kind:'non-http', detail: '端口已断开，可能不支持 HTTP CONNECT' }));
  });
}

export async function selectHttpProxy(preferredPort = 10808, options = {}) {
  const order = [...new Set([Number(preferredPort), 10808, 10809])];
  const results = [];
  for (const port of order) {
    const result = await probeHttpConnect(port, options);
    results.push(result);
    if (result.ok) return { port, results };
  }
  return { port: null, results };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/proxy-check.mjs')) {
  const mode = process.argv[2] || '--choose';
  const input = process.argv[3] || '10808';
  const requested = Number(input);
  if (!/^\d{1,5}$/.test(input) || requested < 1 || requested > 65535) {
    console.error('[ERROR] 输入无效的代理端口：', input);
    process.exitCode = 2;
  } else if (mode === '--choose') {
    console.error(`检测 HTTP / Mixed 代理端口（首选 ${requested}），不仅检测端口开放...`);
    const selected = await selectHttpProxy(requested);
    for (const entry of selected.results) {
      console.error(`${entry.ok ? '[OK]' : '[FAIL]'} 127.0.0.1:${entry.port}: ${entry.detail}`);
    }
    if (selected.port) {
      console.error(`[OK] HTTP 代理 ${selected.port} 可用于 HTTP CONNECT。具体来源仍受平台/节点规则影响。`);
      console.log(`PORT=${selected.port}`);
    } else {
      console.error('[ERROR] 未找到能够建立 HTTPS 隧道的本地 HTTP / Mixed 代理。');
      console.error('请打开 v2rayN 设置 → 参数设置，检查 HTTP 或 Mixed 代理端口及节点是否正在运行。');
      console.error('如果 10808 是纯 SOCKS，请开启 HTTP 或 Mixed 端口（常见 10809）。');
      process.exitCode = 3;
    }
  } else {
    console.error('Unsupported mode:', mode);
    process.exitCode = 2;
  }
}
