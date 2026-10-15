import { test } from 'vitest';
import * as memory from '../src/runtime-safety/quota-reservations.ts';
import * as redis from '../src/runtime-safety/quota-redis.ts';
import { registerQuotaCases } from './quota-cases.mjs';
registerQuotaCases(test, { ...memory, ...redis });
