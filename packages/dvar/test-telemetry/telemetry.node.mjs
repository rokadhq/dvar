import { test } from 'node:test';
import { telemetryCases } from './cases.mjs';
const api = await import(process.env.DVAR_TELEMETRY_ENTRY ?? '../dist/telemetry.js');
telemetryCases(test, api);
