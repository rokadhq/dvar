import { test, afterAll } from 'vitest';
import * as network from '../src/network/index.ts';
import { defineNetworkTests } from './network-cases.mjs';
defineNetworkTests({ test, after: afterAll, ...network });
