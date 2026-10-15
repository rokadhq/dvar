/** Separate Node >=22.13 fixture. It uses a REAL SQLite database and the explicit Dvar contract harness. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, identity, NOW } from './fixtures.mjs';
const api = await import(process.env.DVAR_AUTHORITY_MODULE ?? '../dist/authority.js');

function database(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dvar-authority-'));
  const path = join(dir, 'ownership.sqlite');
  const read = new DatabaseSync(path);
  const concurrent = new DatabaseSync(path);
  t.after(() => { read.close(); concurrent.close(); rmSync(dir, { recursive: true, force: true }); });
  read.exec("CREATE TABLE orders (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, owner TEXT NOT NULL, version INTEGER NOT NULL, amount INTEGER NOT NULL);");
  read.exec("INSERT INTO orders VALUES ('order-1','tenant-a','user-a',1,100);");
  read.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, revoked INTEGER NOT NULL); INSERT INTO sessions VALUES ('session-a',0);");
  const f = fixture(api, {
    verify: () => read.prepare('SELECT revoked FROM sessions WHERE id = ?').get('session-a')?.revoked === 0 ? identity() : null,
    resolve: async (reference, { identity: verified }) => {
      const row = read.prepare('SELECT * FROM orders WHERE id = ? AND tenant = ?').get(reference.id, verified.tenantId);
      return row ? { type: 'order', id: row.id, ownerId: row.owner, tenantId: row.tenant, version: String(row.version),
        observedAtMs: NOW, validUntilMs: NOW + 5000 } : null;
    },
    ...extra
  });
  function update(context) {
    const r = context.resources[0];
    const result = read.prepare('UPDATE orders SET amount = amount + 10, version = version + 1 WHERE id = ? AND tenant = ? AND owner = ? AND version = ?')
      .run(r.id, context.identity.tenantId, context.identity.principal.id, r.version);
    if (result.changes !== 1) throw Object.assign(Error('Conditional resource write failed'), { code: 'resource.version_conflict' });
    return { updated: true };
  }
  return { ...f, read, concurrent, update };
}

test('SQLite provider establishes actual ownership and conditional executor updates the reviewed row', async t => {
  let db;
  db = database(t, { execute: (_args, ctx) => db.update(ctx) });
  assert.deepEqual(await db.call(), { updated: true });
  assert.equal(db.read.prepare('SELECT amount FROM orders').get().amount, 110);
});

test('SQLite tenant scoping does not return another tenant record or invoke the executor', async t => {
  const db = database(t, { verify: () => identity({ tenantId: 'tenant-b' }) });
  await assert.rejects(db.call(), { code: 'ownership.denied' });
  assert.equal(db.state.executions, 0); assert.equal(db.read.prepare('SELECT amount FROM orders').get().amount, 100);
});

test('separate database connection changes ownership during approval: dispatch is blocked', async t => {
  let db;
  db = database(t, { beforeDispatch: () => db.concurrent.prepare('UPDATE orders SET owner = ?, version = version + 1').run('user-b') });
  await assert.rejects(db.call(), { code: 'ownership.denied' }); assert.equal(db.state.executions, 0);
});

test('separate database connection revokes the authenticated session before dispatch', async t => {
  let db;
  db = database(t, { beforeDispatch: () => db.concurrent.exec('UPDATE sessions SET revoked = 1') });
  await assert.rejects(db.call(), { code: 'identity.invalid' }); assert.equal(db.state.executions, 0);
});

test('CAS rejects a database change AFTER Dvar final recheck; a wrapper alone is not an atomic DB authorization', async t => {
  let db;
  db = database(t, { execute: (_args, ctx) => {
    db.concurrent.exec('UPDATE orders SET version = version + 1');
    return db.update(ctx);
  } });
  await assert.rejects(db.call(), { code: 'resource.version_conflict' });
  assert.equal(db.read.prepare('SELECT amount FROM orders').get().amount, 100);
});

test('25 concurrently admitted writes sharing one revision produce only one conditional mutation', async t => {
  let entered = 0; let release; const wait = new Promise(resolve => { release = resolve; });
  let db;
  db = database(t, { execute: async (_args, ctx) => {
    entered += 1; if (entered === 25) release();
    await wait; return db.update(ctx);
  } });
  const results = await Promise.allSettled(Array.from({ length: 25 }, () => db.call()));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'resource.version_conflict').length, 24);
  assert.equal(db.read.prepare('SELECT amount FROM orders').get().amount, 110);
});
