import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
for (const format of ['js', 'cjs']) {
  const entry = new URL(`packages/dvar/dist/authority.${format}`, root);
  if (!existsSync(entry)) throw new Error('Build @rokadhq/dvar before running authority package tests.');
  const result = spawnSync(process.execPath, ['--test', 'packages/dvar/test-authority/authority.node.mjs'], {
    cwd: fileURLToPath(root), stdio: 'inherit',
    env: { ...process.env, DVAR_AUTHORITY_MODULE: entry.href }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
