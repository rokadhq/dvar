import { test, after } from 'node:test';
import * as network from '../dist/network.js';
import { defineNetworkTests } from './network-cases.mjs';
defineNetworkTests({ test, after, ...network });
