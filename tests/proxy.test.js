import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { probeHttpConnect } from '../proxy-check.mjs';

async function withServer(onData, fn) {
  const server = net.createServer(sock => sock.once('data', data => onData(sock, data)));
  server.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try { await fn(server.address().port); } finally { await new Promise(r => server.close(r)); }
}

test('Proxy preflight detects actual CONNECT 200 HTTP proxy', async () => {
  await withServer((sock, data) => {
    assert.match(data.toString(), /^CONNECT www\.example\.com:443 HTTP\/1\.1/);
    sock.write('HTTP/1.1 200 Connection established\r\n\r\n');
  }, async port => {
    const result = await probeHttpConnect(port, { timeoutMs: 1000 });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  });
});

test('Proxy preflight rejects a TCP open SOCKS-only listener', async () => {
  await withServer((sock) => sock.end(Buffer.from([0x05,0x00])), async port => {
    const result = await probeHttpConnect(port, {timeoutMs: 1000});
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'non-http');
  });
});

test('Proxy preflight distinguishes upstream HTTP 502 from tunnel success', async () => {
  await withServer((sock) => sock.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'), async port => {
    const result = await probeHttpConnect(port, {timeoutMs: 1000});
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
  });
});
