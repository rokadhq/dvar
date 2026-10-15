// Minimal RESP2 client for isolated integration tests, not a supported production client.
import { createConnection } from 'node:net';
function parse(buffer, offset = 0) {
  const end = buffer.indexOf('\r\n', offset);
  if (end < 0) return undefined;
  const marker = buffer[offset]; const text = buffer.toString('utf8', offset + 1, end);
  if (marker === 43 || marker === 58 || marker === 45) return { value: marker === 58 ? Number(text) : marker === 45 ? new Error(text) : text, next: end + 2 };
  if (marker === 36) {
    const size = Number(text); if (size === -1) return { value: null, next: end + 2 };
    if (buffer.length < end + 2 + size + 2) return undefined;
    return { value: buffer.toString('utf8', end + 2, end + 2 + size), next: end + 2 + size + 2 };
  }
  if (marker === 42) {
    const count = Number(text); const values = []; let cursor = end + 2;
    for (let index = 0; index < count; index++) { const result = parse(buffer, cursor); if (!result) return undefined; values.push(result.value); cursor = result.next; }
    return { value: values, next: cursor };
  }
  throw new Error('Unsupported RESP response');
}
export function createTestRedisClient(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== 'redis:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Tests require an unauthenticated disposable loopback Redis/Valkey server');
  }
  function command(...parts) {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 6379) });
      let buffer = Buffer.alloc(0); let settled = false;
      function finish(error, value) { if (settled) return; settled = true; socket.destroy(); error ? reject(error) : resolve(value); }
      socket.setTimeout(5000, () => finish(new Error('RESP timeout')));
      socket.on('error', error => finish(error));
      socket.on('end', () => { if (!settled) finish(new Error('Connection ended before reply')); });
      socket.on('connect', () => socket.write(`*${parts.length}\r\n${parts.map(value => `$${Buffer.byteLength(String(value))}\r\n${value}\r\n`).join('')}`));
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 8 * 1024 * 1024) { finish(new Error('RESP reply too large')); return; }
        try { const result = parse(buffer); if (result) finish(result.value instanceof Error ? result.value : null, result.value); }
        catch (error) { finish(error); }
      });
    });
  }
  return { command, eval: (script, { keys, arguments: args }) => command('EVAL', script, keys.length, ...keys, ...args) };
}
