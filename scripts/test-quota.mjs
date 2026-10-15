import { spawnSync } from 'node:child_process';
const files = ['packages/dvar/test-quota/quota.node.mjs'];
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
