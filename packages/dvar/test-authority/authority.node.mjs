import test from 'node:test';
import { registerAuthorityTests } from './cases.mjs';
const api = await import(process.env.DVAR_AUTHORITY_MODULE ?? '../dist/authority.js');
registerAuthorityTests(test, api);
