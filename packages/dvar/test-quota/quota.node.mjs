import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerQuotaCases } from './quota-cases.mjs';
const api = await import(process.env.DVAR_QUOTA_MODULE
  ? pathToFileURL(resolve(process.env.DVAR_QUOTA_MODULE)).href
  : new URL('../dist/runtime-safety.js', import.meta.url).href);
registerQuotaCases(test, api);
