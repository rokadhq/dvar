import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createTestRedisClient } from './resp-client.mjs';
import { createRedisQuotaReservationStore, createValkeyQuotaReservationStore } from '../dist/runtime-safety.js';

// Explicit test target: missing server is a FAILURE, not a silently skipped green test.
if (!process.env.DVAR_QUOTA_REDIS_URL) throw new Error('Set DVAR_QUOTA_REDIS_URL to a disposable local Redis/Valkey server');
const client = createTestRedisClient(process.env.DVAR_QUOTA_REDIS_URL);
const namespaces = [];
const keyFor = name => `dvar:quota:v1:{${createHash('sha256').update(name).digest('hex')}}`;
function store(factory = createRedisQuotaReservationStore, extras = {}) {
  const namespace = `dvar-test-${randomUUID()}`; namespaces.push(namespace);
  return { namespace, value: factory({ namespace, client, ...extras }) };
}
after(async () => { for (const name of namespaces) await client.command('DEL', keyFor(name)); });
const request = (id, counters, binding = 'reviewed') => ({ requestId: id, binding, counters });
const counter = (key, amount = 1, limit = 10, windowMs = 60000) => ({ key, amount, limit, windowMs });

test('real server serializes overlapping reservations from independent clients', async () => {
  const first = store();
  const second = createRedisQuotaReservationStore({ namespace: first.namespace, client: createTestRedisClient(process.env.DVAR_QUOTA_REDIS_URL) });
  const results = await Promise.all(Array.from({ length: 200 }, (_, index) => (index % 2 ? first.value : second).reserve(request(`r${index}`, [counter('a', 1, 100), counter('b', 1, 37)]))));
  assert.equal(results.filter(x => x.status === 'reserved').length, 37);
  assert.equal(results.filter(x => x.status === 'denied').length, 163);
  const state = JSON.parse(await client.command('GET', keyFor(first.namespace)));
  assert.deepEqual(Object.values(state.counters).map(x => x.units), ['37000000', '37000000']);
});

test('real committed reservation survives injected lost reply without double charge', async () => {
  const first = store();
  const lossy = createRedisQuotaReservationStore({ namespace: first.namespace, client: {
    async eval(...args) { await client.eval(...args); throw new Error('injected reply loss after commit'); }
  } });
  const req = request('same', [counter('budget')]);
  await assert.rejects(lossy.reserve(req));
  const replay = await first.value.reserve(req);
  assert.equal(replay.status, 'replayed'); assert.equal(replay.counters[0].value, 1);
  assert.equal((await first.value.reserve({ ...req, binding: 'changed' })).status, 'conflict');
});

test('real decimal budgets retain exact accounting across round trips', async () => {
  const { value } = store(createValkeyQuotaReservationStore);
  for (let i = 0; i < 3; i++) assert.equal((await value.reserve(request(`${i}`, [counter('money', 0.1, 0.3)]))).status, 'reserved');
  assert.equal((await value.reserve(request('4', [counter('money', 0.1, 0.3)]))).status, 'denied');
});

test('corrupt partition state fails closed without overwriting it', async () => {
  const entry = store(); const key = keyFor(entry.namespace);
  await client.command('SET', key, '{invalid json');
  await assert.rejects(entry.value.reserve(request('one', [counter('a')])));
  assert.equal(await client.command('GET', key), '{invalid json');
});

test('partition clock comes from the server, not a caller timestamp', async () => {
  const { value } = store(); const before = Date.now();
  const result = await value.reserve(request('one', [counter('a', 1, 10, 1000)]));
  assert.ok(result.counters[0].resetAtMs >= before + 900);
  assert.ok(result.counters[0].resetAtMs <= Date.now() + 1100);
});
