import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadV1Catalog, validateV1Catalog, releaseBlockers, repositoryRoot } from '../../../scripts/v1-plan.mjs';

const fresh = () => structuredClone(loadV1Catalog());
test('the accepted plan tracks exactly F01 through F55 without dependency cycles', () => {
  const catalog = fresh();
  assert.equal(catalog.features.length, 55);
  assert.deepEqual(validateV1Catalog(catalog), []);
  assert.equal(catalog.features.filter(f => f.status === 'verified').length, 0);
});
test('release remains blocked for 0.7 and for an unapproved 1.0 version bump', () => {
  const catalog = fresh();
  for (const version of ['0.7.0', '1.0.0']) {
    const blockers = releaseBlockers(catalog, version);
    assert.ok(blockers.includes('Publication is on hold.'));
    assert.ok(blockers.includes('55 of 55 features are not verified.'));
  }
});
test('missing and duplicate feature IDs cannot shorten the release scope', () => {
  const catalog = fresh(); catalog.features.pop();
  assert.ok(validateV1Catalog(catalog).some(e => e.includes('exactly 55')));
  const duplicate = fresh(); duplicate.features[1].id = 'F01';
  assert.ok(validateV1Catalog(duplicate).some(e => e.includes('duplicate')));
});
test('invalid status and dependency cycles are rejected', () => {
  const catalog = fresh(); catalog.features[0].status = 'done';
  catalog.features[0].dependsOn = ['F02']; catalog.features[1].dependsOn = ['F01'];
  const errors = validateV1Catalog(catalog);
  assert.ok(errors.some(e => e.includes('invalid status')));
  assert.ok(errors.some(e => e.includes('Cyclic')));
});
test('verified features need implementation, test, documentation and review evidence', () => {
  const catalog = fresh(); catalog.features[2].status = 'verified';
  const errors = validateV1Catalog(catalog);
  for (const kind of ['implementation', 'tests', 'documentation', 'review']) {
    assert.ok(errors.some(e => e.includes(`${kind} evidence is required`)));
  }
});
test('nonexistent and external evidence paths are rejected', () => {
  const catalog = fresh();
  catalog.features[0].evidence.review = ['../outside', '/etc/passwd', 'does-not-exist.md'];
  const errors = validateV1Catalog(catalog);
  assert.ok(errors.some(e => e.includes('unsafe evidence path')));
  assert.ok(errors.some(e => e.includes('evidence file missing')));
});
test('changing sign-off flags cannot release unfinished features', () => {
  const catalog = fresh();
  catalog.release = { onHold: false, ownerApproved: true, securityReviewApproved: true, compatibilityQualified: true };
  assert.ok(releaseBlockers(catalog, '1.0.0').some(e => e.includes('not verified')));
});
test('a fully evidenced and approved test fixture passes the metadata gate only', () => {
  const root = mkdtempSync(join(tmpdir(), 'dvar-release-gate-'));
  try {
    mkdirSync(join(root, 'evidence'));
    writeFileSync(join(root, 'evidence', 'test-only.txt'), 'Synthetic gate test fixture; not real qualification.');
    const catalog = fresh();
    catalog.release = { onHold: false, ownerApproved: true, securityReviewApproved: true, compatibilityQualified: true };
    for (const feature of catalog.features) {
      feature.status = 'verified';
      for (const key of Object.keys(feature.evidence)) feature.evidence[key] = ['evidence/test-only.txt'];
    }
    assert.deepEqual(releaseBlockers(catalog, '1.0.0', root), []);
    assert.ok(releaseBlockers(catalog, '1.0.0-alpha.1', root).length > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('package prepublish lifecycle exits nonzero under the actual hold', () => {
  const result = spawnSync(process.execPath, ['packages/dvar/scripts/prepublish.mjs'], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Publication is on hold/);
  assert.match(result.stderr, /55 of 55/);
});
