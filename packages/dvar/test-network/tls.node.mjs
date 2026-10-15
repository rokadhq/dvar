import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const fixture = name => new URL(`./fixtures/${name}`, import.meta.url);
const moduleUrl = new URL('../dist/network.js', import.meta.url).href;

async function runClient(port, hostname, trusted = true) {
  const source = `
    import { createGuardedFetch } from ${JSON.stringify(moduleUrl)};
    const guarded = createGuardedFetch({
      policy: { allowedHosts: [${JSON.stringify(hostname)}], allowedPorts: [${port}], allowedPrivateAddresses: ['127.0.0.1'] },
      resolve: async () => [{ address: '127.0.0.1', family: 4 }]
    });
    try { console.log(await (await guarded('https://${hostname}:${port}/')).text()); }
    catch(error) { console.log(error.code); process.exitCode = 2; }
  `;
  const env = { ...process.env };
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  delete env.NODE_OPTIONS;
  delete env.NODE_EXTRA_CA_CERTS;
  if (trusted) env.NODE_EXTRA_CA_CERTS = fileURLToPath(fixture('ca.pem'));
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => stdout += value);
  child.stderr.on('data', value => stderr += value);
  const [exitCode] = await once(child, 'close');
  return { exitCode, stdout, stderr };
}

for (const [hostname, trusted, success] of [
  ['service.example', true, true],
  ['other.example', true, false],
  ['service.example', false, false]
]) test(`TLS pinned connection: host=${hostname}, trusted=${trusted}`, async () => {
  let received = 0, sni, host;
  const server = createServer({ key: readFileSync(fixture('server-key.pem')), cert: readFileSync(fixture('server-cert.pem')) }, (request, response) => {
    received++; host = request.headers.host; sni = request.socket.servername;
    response.end('tls-ok');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  try {
    const result = await runClient(port, hostname, trusted);
    assert.equal(result.exitCode, success ? 0 : 2, result.stderr);
    assert.equal(received, success ? 1 : 0);
    if (success) {
      assert.equal(result.stdout.trim(), 'tls-ok');
      assert.equal(sni, 'service.example'); assert.equal(host, `service.example:${port}`);
    } else assert.equal(result.stdout.trim(), 'network.transport_error');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
