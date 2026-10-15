import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = new URL('../packages/dvar/test-network/', import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith('.node.mjs')).sort();
if (!files.length) throw new Error('Network and release-gate tests are missing.');
const child = spawnSync(process.execPath, ['--test', ...files.map(name => fileURLToPath(new URL(name, directory)))], { stdio: 'inherit' });
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
