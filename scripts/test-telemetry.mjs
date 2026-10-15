import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
for (const format of ['js', 'cjs']) {
  const entry = new URL(`../packages/dvar/dist/telemetry.${format}`, import.meta.url);
  const tests = fileURLToPath(new URL('../packages/dvar/test-telemetry/telemetry.node.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--test', tests], {
    stdio: 'inherit', env: { ...process.env, DVAR_TELEMETRY_ENTRY: entry.href }
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
