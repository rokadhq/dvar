import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

export function defineNetworkTests({ test, after, createGuardedFetch, classifyIpAddress, DvarNetworkError }) {
const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); });
const policy = { allowedHosts: ['example.com'] };
const errorCode = code => error => error instanceof DvarNetworkError && error.code === code;
const failFetch = (url, code, options = {}, init) => assert.rejects(
  createGuardedFetch({ policy, ...options })(url, init), errorCode(code)
);

async function localServer(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  closers.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { server, port, url: `http://127.0.0.1:${port}` };
}
function localOptions(port, extra = {}, resolve) {
  return {
    policy: { allowedHosts: ['127.0.0.1', 'service.example'], allowHttp: true,
      allowedPorts: [port], allowedPrivateAddresses: ['127.0.0.1'],
      timeoutMs: 2000, ...extra },
    ...(resolve ? { resolve } : {})
  };
}

for (const ip of [
  '0.0.0.0', '127.0.0.1', '127.255.255.255', '10.0.0.1', '172.16.1.2',
  '172.31.255.255', '192.168.1.2', '169.254.169.254', '100.100.100.200',
  '168.63.129.16', '192.0.0.8', '192.0.2.1', '192.88.99.1', '198.18.0.1',
  '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
  '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1',
  'fc00::1', 'fd00::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '2001:db8::1',
  '2001::1', '2002:7f00:1::1', '64:ff9b::7f00:1', '3fff::1', 'not-an-ip'
]) test(`non-public address classification: ${ip}`, () => {
  assert.notEqual(classifyIpAddress(ip), 'public');
});
for (const ip of ['1.1.1.1', '8.8.8.8', '172.15.255.255', '172.32.0.0', '192.169.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
  test(`ordinary public address classification: ${ip}`, () => assert.equal(classifyIpAddress(ip), 'public'));
}

test('no host allowlist means deny all before DNS', async () => {
  let resolutions = 0;
  await failFetch('https://example.com', 'network.host_not_allowed', {
    policy: {}, resolve: async () => { resolutions++; return []; }
  });
  assert.equal(resolutions, 0);
});
test('unapproved host and unsafe port/method are rejected before DNS', async () => {
  let resolutions = 0;
  const resolve = async () => { resolutions++; return []; };
  await failFetch('https://example.com.evil.test', 'network.host_not_allowed', { resolve });
  await failFetch('https://example.com:444', 'network.port_denied', { resolve });
  await failFetch('https://example.com', 'network.method_denied', { resolve }, { method: 'POST' });
  assert.equal(resolutions, 0);
});
test('host deny rules take precedence over wildcard allow rules', async () => {
  await failFetch('https://evil.example.com', 'network.host_denied', {
    policy: { allowedHosts: ['*.example.com'], deniedHosts: ['evil.example.com'] }
  });
  await failFetch('https://example.com', 'network.host_not_allowed', {
    policy: { allowedHosts: ['*.example.com'] }
  });
  await failFetch('https://notexample.com', 'network.host_not_allowed', {
    policy: { allowedHosts: ['*.example.com'] }
  });
});
test('case, IDNA and a trailing dot normalize before matching', async () => {
  const seen = [];
  const fetch = createGuardedFetch({ policy: { allowedHosts: ['EXAMPLE.com.', 'bücher.example'] },
    resolve: async host => { seen.push(host); return [{ address: '127.0.0.1', family: 4 }]; }
  });
  await assert.rejects(fetch('https://EXAMPLE.COM./'), errorCode('network.address_denied'));
  await assert.rejects(fetch('https://bücher.example/'), errorCode('network.address_denied'));
  assert.deepEqual(seen, ['example.com', 'xn--bcher-kva.example']);
});
for (const spelling of ['2130706433', '0177.0.0.1', '0x7f000001', '127.1', '[::ffff:127.0.0.1]']) {
  test(`alternate private IP spelling cannot bypass checks: ${spelling}`, async () => {
    const canonical = new URL(`https://${spelling}`).hostname.replace(/^\[|\]$/g, '');
    await failFetch(`https://${spelling}`, 'network.address_denied', { policy: { allowedHosts: [canonical] } });
  });
}
for (const input of ['file:///etc/passwd', 'ftp://example.com', 'data:text/plain,hello']) {
  test(`reject non-HTTP scheme: ${input.split(':')[0]}`, () => failFetch(input, 'network.scheme_denied'));
}
for (const input of [' https://example.com', 'https://example.com\n', 'https://example.com\\@evil.test', 'https://example.com/ bad']) {
  test('reject parser-ambiguous URL', () => failFetch(input, 'network.url_invalid'));
}
test('embedded credentials rejected without exposing them', async () => {
  await assert.rejects(createGuardedFetch({ policy })('https://secret:password@example.com?token=hidden'), error => {
    assert.equal(error.code, 'network.credentials_denied');
    assert.doesNotMatch(JSON.stringify(error) + error.message, /password|hidden/);
    return true;
  });
});
test('plain HTTP and metadata hostname rejected', async () => {
  await failFetch('http://example.com', 'network.scheme_denied');
  await failFetch('https://metadata.google.internal', 'network.metadata_denied', { policy: { allowedHosts: ['metadata.google.internal'] } });
});
test('mixed A/AAAA answers reject the entire DNS answer set', async () => {
  for (const addresses of [
    [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }],
    [{ address: '8.8.8.8', family: 4 }, { address: 'fd00::1', family: 6 }]
  ]) await failFetch('https://example.com', 'network.address_denied', { resolve: async () => addresses });
});
test('failed, empty, malformed and oversized DNS answers fail closed', async () => {
  await failFetch('https://example.com', 'network.dns_failed', { resolve: async () => { throw new Error('SECRET'); } });
  for (const records of [[], null, [{ address: '8.8.8.8', family: 6 }], [{ address: 'invalid', family: 4 }],
    Array(65).fill({ address: '8.8.8.8', family: 4 })]) {
    await failFetch('https://example.com', 'network.dns_invalid', { resolve: async () => records });
  }
});
test('policy configuration is copied, not mutable through the caller', async () => {
  const configured = { allowedHosts: ['example.com'], allowedPorts: [443], allowedMethods: ['GET'] };
  const guarded = createGuardedFetch({ policy: configured, resolve: async () => [] });
  configured.allowedHosts.push('evil.example'); configured.allowedPorts.push(8443); configured.allowedMethods.push('POST');
  await assert.rejects(guarded('https://evil.example'), errorCode('network.host_not_allowed'));
  await assert.rejects(guarded('https://example.com:8443'), errorCode('network.port_denied'));
  await assert.rejects(guarded('https://example.com', { method: 'POST' }), errorCode('network.method_denied'));
});
for (const policy of [
  { maxRedirects: -1 }, { timeoutMs: NaN }, { timeoutMs: Infinity }, { maxResponseBytes: -1 },
  { allowedPorts: [0] }, { allowedMethods: ['CONNECT'] }, { allowHttp: 'yes' },
  { allowedHosts: ['https://example.com'] }, { allowedHosts: ['example.com:443'] },
  { allowedHosts: ['*'] }, { allowedHosts: ['*.127.0.0.1'] },
  { allowedPrivateAddresses: ['169.254.169.254'] }, { allowedPrivateAddresses: ['8.8.8.8'] }
]) test('invalid policy is rejected at construction', () => {
  assert.throws(() => createGuardedFetch({ policy }), errorCode('network.configuration_invalid'));
});

test('connects to pinned address, preserves Host, and performs only one DNS resolution', async () => {
  let calls = 0; let host;
  const { port } = await localServer((request, response) => { host = request.headers.host; calls++; response.end('ok'); });
  let lookups = 0;
  const guarded = createGuardedFetch(localOptions(port, {}, async hostname => {
    assert.equal(hostname, 'service.example'); lookups++;
    return [{ address: '127.0.0.1', family: 4 }];
  }));
  const response = await guarded(`http://service.example:${port}/a?q=1`);
  assert.equal(await response.text(), 'ok'); assert.equal(host, `service.example:${port}`);
  assert.equal(lookups, 1); assert.equal(calls, 1); assert.equal(response.redirected, false);
});
test('explicit private exception is exact, not a network-wide permission', async () => {
  const { port } = await localServer((_request, response) => response.end('ok'));
  const guarded = createGuardedFetch(localOptions(port, {}, async () => [{ address: '127.0.0.2', family: 4 }]));
  await assert.rejects(guarded(`http://service.example:${port}`), errorCode('network.address_denied'));
});
test('Request input preserves method, headers, body and abort semantics', async () => {
  const { url, port } = await localServer(async (request, response) => {
    let data = ''; for await (const chunk of request) data += chunk;
    response.end(`${request.method}:${request.headers['x-test']}:${data}`);
  });
  const guarded = createGuardedFetch(localOptions(port, { allowedMethods: ['POST'] }));
  const response = await guarded(new Request(url, { method: 'POST', headers: { 'x-test': 'value' }, body: 'hello' }));
  assert.equal(await response.text(), 'POST:value:hello');
});
test('redirects are denied by default and manual mode does not follow them', async () => {
  let requests = 0;
  const { url, port } = await localServer((_request, response) => { requests++; response.writeHead(302, { location: '/next' }); response.end(); });
  const guarded = createGuardedFetch(localOptions(port));
  await assert.rejects(guarded(url), errorCode('network.redirect_denied'));
  const response = await guarded(url, { redirect: 'manual' });
  assert.equal(response.status, 302); assert.equal(requests, 2);
});
test('same-origin GET redirects are re-resolved, bounded, and preserve status metadata', async () => {
  let lookups = 0;
  const { port } = await localServer((request, response) => {
    if (request.url === '/start') { response.writeHead(302, { location: '/end' }); response.end(); }
    else response.end('finished');
  });
  const guarded = createGuardedFetch(localOptions(port, { maxRedirects: 1 }, async () => {
    lookups++; return [{ address: '127.0.0.1', family: 4 }];
  }));
  const response = await guarded(`http://service.example:${port}/start`);
  assert.equal(await response.text(), 'finished'); assert.equal(lookups, 2);
  assert.equal(response.redirected, true); assert.match(response.url, /\/end$/);
});
test('DNS rebinding on a redirect is rejected before the second connection', async () => {
  let requests = 0; let lookups = 0;
  const { port } = await localServer((_request, response) => { requests++; response.writeHead(302, { location: '/next' }); response.end(); });
  const guarded = createGuardedFetch(localOptions(port, { maxRedirects: 2 }, async () => {
    lookups++; return [{ address: lookups === 1 ? '127.0.0.1' : '169.254.169.254', family: 4 }];
  }));
  await assert.rejects(guarded(`http://service.example:${port}`), errorCode('network.address_denied'));
  assert.equal(lookups, 2); assert.equal(requests, 1);
});
test('cross-origin redirects never receive authorization or custom secret headers', async () => {
  let leaked = 0;
  const destination = await localServer((_request, response) => { leaked++; response.end(); });
  const source = await localServer((_request, response) => { response.writeHead(307, { location: destination.url }); response.end(); });
  const guarded = createGuardedFetch(localOptions(source.port, { maxRedirects: 2, allowedPorts: [source.port, destination.port] }));
  await assert.rejects(guarded(source.url, { headers: { authorization: 'Bearer secret', 'x-api-key': 'private' } }), errorCode('network.redirect_origin_denied'));
  assert.equal(leaked, 0);
});
test('POST redirects cannot replay or rewrite a side-effecting request', async () => {
  let calls = 0;
  const { url, port } = await localServer((_request, response) => { calls++; response.writeHead(303, { location: '/next' }); response.end(); });
  const guarded = createGuardedFetch(localOptions(port, { maxRedirects: 3, allowedMethods: ['POST'] }));
  await assert.rejects(guarded(url, { method: 'POST', body: 'side effect' }), errorCode('network.redirect_method_denied'));
  assert.equal(calls, 1);
});
test('redirect loops terminate at configured limit', async () => {
  let calls = 0;
  const { url, port } = await localServer((_request, response) => { calls++; response.writeHead(302, { location: '/' }); response.end(); });
  await assert.rejects(createGuardedFetch(localOptions(port, { maxRedirects: 2 }))(url), errorCode('network.redirect_denied'));
  assert.equal(calls, 3);
});
test('request byte cap applies before contacting the server', async () => {
  let calls = 0;
  const { url, port } = await localServer((_request, response) => { calls++; response.end(); });
  await assert.rejects(createGuardedFetch(localOptions(port, { maxRequestBytes: 4, allowedMethods: ['POST'] }))(url, { method: 'POST', body: '12345' }), errorCode('network.request_too_large'));
  assert.equal(calls, 0);
});
test('response caps apply to advertised and streamed response bytes', async () => {
  for (const advertised of [false, true]) {
    const { url, port } = await localServer((_request, response) => {
      if (advertised) response.setHeader('content-length', 32);
      response.write('12345678'); response.end('123456789012345678901234');
    });
    await assert.rejects(createGuardedFetch(localOptions(port, { maxResponseBytes: 4 }))(url), errorCode('network.response_too_large'));
  }
});
test('compressed responses fail closed rather than bypassing output controls', async () => {
  const { url, port } = await localServer((_request, response) => { response.setHeader('content-encoding', 'gzip'); response.end('compressed'); });
  await assert.rejects(createGuardedFetch(localOptions(port))(url), errorCode('network.encoding_unsupported'));
});
test('Host, framing and proxy authorization cannot be overridden', async () => {
  for (const headers of [{ host: 'internal.local' }, { 'content-length': '1' }, { 'proxy-authorization': 'secret' }, { connection: 'upgrade' }]) {
    await failFetch('https://example.com', 'network.header_denied', {}, { headers });
  }
});
test('deadline includes stalled DNS and no connection occurs afterwards', async () => {
  let calls = 0; let resolve;
  const { port } = await localServer((_request, response) => { calls++; response.end(); });
  const guarded = createGuardedFetch(localOptions(port, { timeoutMs: 30 }, () => new Promise(r => { resolve = r; })));
  await assert.rejects(guarded(`http://service.example:${port}`), errorCode('network.timeout'));
  resolve([{ address: '127.0.0.1', family: 4 }]);
  await new Promise(r => setTimeout(r, 30)); assert.equal(calls, 0);
});
test('pre-aborted request does not resolve DNS', async () => {
  let calls = 0; const abort = new AbortController(); abort.abort('secret reason');
  await failFetch('https://example.com', 'network.aborted', { resolve: async () => { calls++; return []; } }, { signal: abort.signal });
  assert.equal(calls, 0);
});
test('deadline covers a stalled response body', async () => {
  const { url, port } = await localServer((_request, response) => { response.writeHead(200); response.write('a'); });
  await assert.rejects(createGuardedFetch(localOptions(port, { timeoutMs: 40 }))(url), errorCode('network.timeout'));
});
test('deadline covers an unending upload stream', async () => {
  let calls = 0;
  const { url, port } = await localServer((_request, response) => { calls++; response.end(); });
  const body = new ReadableStream({ start() {} });
  await assert.rejects(createGuardedFetch(localOptions(port, { timeoutMs: 40, allowedMethods: ['POST'] }))(url, { method: 'POST', body, duplex: 'half' }), errorCode('network.timeout'));
  assert.equal(calls, 0);
});
test('HEAD and no-content responses have no body', async () => {
  const { url, port } = await localServer((_request, response) => { response.writeHead(204); response.end(); });
  const response = await createGuardedFetch(localOptions(port))(url, { method: 'HEAD' });
  assert.equal(response.status, 204); assert.equal(response.body, null);
});
test('transport errors do not reveal destination path/query or secrets', async () => {
  const server = await localServer((_request, response) => response.end());
  await new Promise(resolve => server.server.close(resolve));
  const guarded = createGuardedFetch(localOptions(server.port));
  await assert.rejects(guarded(`${server.url}/SECRET_PATH?token=PRIVATE_QUERY`), error => {
    assert.equal(error.code, 'network.transport_error');
    assert.doesNotMatch(String(error.stack), /SECRET_PATH|PRIVATE_QUERY/);
    return true;
  });
});

}
