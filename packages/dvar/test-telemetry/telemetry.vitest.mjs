import { test } from 'vitest';
import * as api from '../src/telemetry/index.ts';
import { telemetryCases } from './cases.mjs';
telemetryCases(test, api);
