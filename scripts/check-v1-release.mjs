import { readFileSync } from 'node:fs';
import { loadV1Catalog, releaseBlockers } from './v1-plan.mjs';
try {
  const { version } = JSON.parse(readFileSync(new URL('../packages/dvar/package.json', import.meta.url), 'utf8'));
  const blockers = releaseBlockers(loadV1Catalog(), version);
  if (blockers.length) throw new Error(`Dvar is not approved for release:\n${blockers.join('\n')}`);
  console.log('Dvar v1 release metadata is complete. Publishing still requires the reviewed release workflow.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Dvar release gate unavailable.');
  process.exitCode = 1;
}
