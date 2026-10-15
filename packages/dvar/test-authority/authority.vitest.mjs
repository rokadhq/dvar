import { test } from 'vitest';
import * as api from '../src/authority/index.ts';
import { registerAuthorityTests } from './cases.mjs';
registerAuthorityTests(test, api);
