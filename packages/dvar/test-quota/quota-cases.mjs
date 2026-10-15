import assert from 'node:assert/strict';

export function registerQuotaCases(test, api) {
const { createInMemoryQuotaReservationStore: memory, createRedisQuotaReservationStore: redis, createValkeyQuotaReservationStore: valkey } = api;
const counter = (key = 'calls', amount = 1, limit = 10, windowMs = 1000) => ({ key, amount, limit, windowMs });
const request = (id = 'one', counters = [counter()], binding = 'reviewed') => ({ requestId: id, binding, counters });
const opts = (extras = {}) => ({ namespace: 'test', clock: () => 100, ...extras });
const reservedReply = (value = '1') => JSON.stringify({ status: 'reserved', counters: [{ value, limit: '10', resetAtMs: 1000 }] });

test('reserves every counter or none of them', () => {
  const store = memory(opts());
  const group = [counter('a', 1, 5), counter('b', 2, 2)];
  assert.equal(store.reserve(request('first', group)).status, 'reserved');
  const denied = store.reserve(request('second', group));
  assert.equal(denied.status, 'denied');
  assert.equal(denied.deniedIndex, 1);
  assert.deepEqual(denied.counters.map(x => x.value), [1, 2]);
  assert.equal(store.reserve(request('third', [counter('a', 4, 5)])).status, 'reserved');
});

test('concurrent distinct admissions never oversubscribe overlapping budgets', async () => {
  const store = memory(opts({ maxReceipts: 1500 }));
  const group = [counter('a', 1, 400), counter('b', 1, 73)];
  const results = await Promise.all(Array.from({ length: 1000 }, (_, index) => Promise.resolve().then(() => store.reserve(request(`r${index}`, group)))));
  assert.equal(results.filter(x => x.status === 'reserved').length, 73);
  assert.equal(results.filter(x => x.status === 'denied').length, 927);
  const probe = store.reserve(request('probe', [counter('a', 0, 400), counter('b', 0, 73)]));
  assert.deepEqual(probe.counters.map(x => x.value), [73, 73]);
});

test('concurrent identical attempts charge once and return non-authorizing receipts', async () => {
  const store = memory(opts());
  const results = await Promise.all(Array.from({ length: 100 }, () => Promise.resolve().then(() => store.reserve(request()))));
  assert.equal(results.filter(x => x.status === 'reserved').length, 1);
  assert.equal(results.filter(x => x.status === 'replayed').length, 99);
  assert.equal(results[99].originalStatus, 'reserved');
  assert.equal(results[99].counters[0].value, 1);
});

for (const [label, changed] of [
  ['action binding', request('one', [counter()], 'changed')],
  ['amount', request('one', [counter('calls', 2)])],
  ['limit', request('one', [counter('calls', 1, 11)])],
  ['scope key', request('one', [counter('other')])],
  ['window', request('one', [counter('calls', 1, 10, 2000)])]
]) test(`same receipt ID rejects changed ${label}`, () => {
  const store = memory(opts()); store.reserve(request());
  assert.equal(store.reserve(changed).status, 'conflict');
  assert.equal(store.reserve(request('two')).counters[0].value, 2);
});

test('denied receipts stay denied after counter expiry until their own expiry', () => {
  let now = 0; const store = memory(opts({ clock: () => now }));
  store.reserve(request('one', [counter('a', 1, 1, 10)]));
  const denied = request('two', [counter('a', 1, 1, 10)]);
  assert.equal(store.reserve(denied).status, 'denied');
  now = 11;
  assert.equal(store.reserve(denied).originalStatus, 'denied');
  assert.equal(store.reserve(request('three', [counter('a', 1, 1, 10)])).status, 'reserved');
});

test('counter windows do not slide and expired counters can be reclaimed', () => {
  let now = 1; const store = memory(opts({ clock: () => now }));
  assert.equal(store.reserve(request()).counters[0].resetAtMs, 1001);
  now = 500; assert.equal(store.reserve(request('two')).counters[0].resetAtMs, 1001);
  now = 1001; const result = store.reserve(request('three'));
  assert.equal(result.counters[0].value, 1); assert.equal(result.counters[0].resetAtMs, 2001);
});

test('receipt lifetime is bounded and is not extended by replay', () => {
  let now = 0; const store = memory(opts({ clock: () => now, receiptTtlMs: 10 }));
  store.reserve(request()); now = 9; assert.equal(store.reserve(request()).status, 'replayed');
  now = 10; assert.equal(store.reserve(request()).status, 'reserved');
  assert.equal(store.reserve(request()).counters[0].value, 2);
});

test('decimal accounting is exact in integer millionths', () => {
  const store = memory(opts()); const group = [counter('cost', 0.1, 0.3)];
  for (let i = 0; i < 3; i++) assert.equal(store.reserve(request(`${i}`, group)).status, 'reserved');
  assert.equal(store.reserve(request('4', group)).status, 'denied');
  assert.equal(store.reserve(request('probe', [counter('cost', 0, 0.3)])).counters[0].value, 0.3);
  assert.equal(store.reserve(request('micro', [counter('micro', 0.000001, 0.000001)])).status, 'reserved');
});

test('mutating returned data or original options cannot change saved receipts', () => {
  const options = opts({ receiptTtlMs: 10 }); const store = memory(options);
  const result = store.reserve(request()); result.counters[0].value = 900;
  options.receiptTtlMs = 0;
  assert.equal(store.reserve(request()).counters[0].value, 1);
});

test('counter capacity does not evict or partially consume live budgets', () => {
  const store = memory(opts({ maxCounters: 1 })); store.reserve(request());
  assert.throws(() => store.reserve(request('two', [counter(), counter('b')])), { code: 'runtime.quota_capacity_exceeded' });
  assert.equal(store.reserve(request('three')).counters[0].value, 2);
});

test('receipt capacity fails closed while preserving existing receipts', () => {
  const store = memory(opts({ maxReceipts: 1 })); store.reserve(request());
  assert.throws(() => store.reserve(request('two')), { code: 'runtime.quota_capacity_exceeded' });
  assert.equal(store.reserve(request()).status, 'replayed');
});

test('expiry frees capacity without evicting live reservations', () => {
  let now = 0; const store = memory(opts({ maxReceipts: 1, maxCounters: 1, receiptTtlMs: 5, clock: () => now }));
  store.reserve(request('a', [counter('a', 1, 10, 5)])); now = 6;
  assert.equal(store.reserve(request('b', [counter('b')])).status, 'reserved');
});

const badCounters = [
  counter('a', -1), counter('a', NaN), counter('a', Infinity), counter('a', 1e-7),
  counter('a', 1e12), counter('a', 1, 0), counter('a', 1, NaN), counter('a', 1, 1e12),
  counter('a', 1, 10, 0), counter('a', 1, 10, 0.5), counter('a', 1, 10, Infinity),
  counter('a', 1, 10, 2592000001), counter('')
];
for (const [index, value] of badCounters.entries()) test(`invalid counter ${index} is rejected before any reservation`, () => {
  const store = memory(opts());
  assert.throws(() => store.reserve(request('bad', [counter('valid'), value])));
  assert.equal(store.reserve(request('probe', [counter('valid')])).counters[0].value, 1);
});
for (const [index, value] of [request('', [counter()]), request('id', [], 'b'), request('id', [counter()], ''), request('id', [counter(), counter()]), request('id', Array.from({ length: 131 }, (_, i) => counter(`${i}`)))].entries()) {
  test(`malformed batch ${index} is rejected`, () => assert.throws(() => memory(opts()).reserve(value)));
}
for (const value of [{ namespace: '' }, { maxCounters: 0 }, { maxReceipts: 0 }, { receiptTtlMs: Infinity }, { receiptTtlMs: 86400001 }, { maxCounters: 9000 }]) {
  test(`invalid store options ${JSON.stringify(value)} are rejected`, () => assert.throws(() => memory(opts(value))));
}

test('Redis transport sends one opaque partition key and one fixed script', async () => {
  const calls = [];
  const store = redis({ namespace: 'private-tenant', client: { async eval(script, wire) { calls.push({ script, wire }); return reservedReply(); } } });
  await store.reserve(request('private-id', [counter('private-budget')], 'secret-token'));
  assert.equal(calls.length, 1); assert.equal(calls[0].wire.keys.length, 1);
  assert.match(calls[0].wire.keys[0], /^dvar:quota:v1:\{[a-f0-9]{64}\}$/);
  assert.doesNotMatch(JSON.stringify(calls[0].wire), /private-|secret-token/);
  assert.equal((calls[0].script.match(/redis\.call\('SET'/g) ?? []).length, 1);
  assert.match(calls[0].script, /redis\.call\('TIME'/);
});

test('Valkey adapter exposes the same contract without a required client package', async () => {
  const store = valkey({ namespace: 'x', client: { async eval() { return reservedReply(); } } });
  assert.equal(store.kind, 'valkey-quota-v1'); assert.equal(store.distributed, true);
  assert.equal((await store.reserve(request())).status, 'reserved');
});

test('store failure does not expose secrets or automatically retry', async () => {
  let calls = 0;
  const store = redis({ namespace: 'x', client: { async eval() { calls++; throw new Error('redis://user:secret@private'); } } });
  await assert.rejects(store.reserve(request()), error => error.code === 'runtime.quota_store_unavailable' && !error.message.includes('secret'));
  assert.equal(calls, 1);
});

test('store deadline bounds waiting without pretending to roll back a late commit', async () => {
  let calls = 0;
  const store = redis({ namespace: 'x', timeoutMs: 5, client: { eval() { calls++; return new Promise(() => {}); } } });
  await assert.rejects(store.reserve(request()), { code: 'runtime.quota_store_unavailable' }); assert.equal(calls, 1);
});

for (const [index, reply] of [null, 'garbage', '{}', JSON.stringify({ status: 'reserved', counters: [] }), reservedReply('-1'), reservedReply('11'), JSON.stringify({ status: 'denied', counters: [{ value: '1', limit: '10', resetAtMs: 1 }] }), JSON.stringify({ status: 'replayed', counters: [{ value: '1', limit: '10', resetAtMs: 1 }] })].entries()) {
  test(`malformed Redis reply ${index} is rejected`, async () => {
    const store = redis({ namespace: 'x', client: { async eval() { return reply; } } });
    await assert.rejects(store.reserve(request()), { code: 'runtime.quota_reply_invalid' });
  });
}

test('invalid usage is rejected before contacting Redis', async () => {
  let calls = 0; const store = redis({ namespace: 'x', client: { async eval() { calls++; return reservedReply(); } } });
  await assert.rejects(store.reserve(request('bad', [counter('a', -1)]))); assert.equal(calls, 0);
});

test('clock rollback fails closed without erasing live accounting', () => {
  let now = 100; const store = memory(opts({ clock: () => now }));
  store.reserve(request()); now = 99;
  assert.throws(() => store.reserve(request('two')), { code: 'runtime.quota_clock_regressed' });
  now = 101; assert.equal(store.reserve(request('three')).counters[0].value, 2);
});

test('large representable values retain integer precision across reservations', () => {
  const store = memory(opts());
  const first = store.reserve(request('one', [counter('large', 9007199254.740988, 9007199254.74099)]));
  assert.equal(first.status, 'reserved');
  assert.equal(store.reserve(request('two', [counter('large', 0.000002, 9007199254.74099)])).status, 'reserved');
  assert.equal(store.reserve(request('three', [counter('large', 0.000001, 9007199254.74099)])).status, 'denied');
});

test('Redis reply cannot substitute a looser budget limit', async () => {
  const reply = JSON.stringify({ status: 'reserved', counters: [{ value: '1', limit: '20', resetAtMs: 1000 }] });
  await assert.rejects(redis({ namespace: 'x', client: { async eval() { return reply; } } }).reserve(request()), { code: 'runtime.quota_reply_invalid' });
});

}
