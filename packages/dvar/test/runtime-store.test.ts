import { describe, expect, it } from "vitest";
import {
  InMemoryRuntimeStore,
  createRedisRuntimeStore,
  createValkeyRuntimeStore
} from "../src/runtime-safety/index.js";

describe("runtime stores", () => {
  it("atomically rejects counters beyond the limit", () => {
    const store = new InMemoryRuntimeStore();
    const first = store.consumeCounter({
      key: "quota",
      amount: 2,
      limit: 3,
      windowMs: 1000,
      nowMs: 0
    });
    const second = store.consumeCounter({
      key: "quota",
      amount: 2,
      limit: 3,
      windowMs: 1000,
      nowMs: 1
    });
    expect(first).toMatchObject({ allowed: true, value: 2 });
    expect(second).toMatchObject({ allowed: false, value: 2 });
  });

  it("adapts node-redis compatible eval clients for Redis and Valkey", async () => {
    const calls: Array<{ script: string; keys: string[]; arguments: string[] }> = [];
    const client = {
      eval: async (
        script: string,
        options: { keys: string[]; arguments: string[] }
      ) => {
        calls.push({ script, ...options });
        return [1, "1", "1000"];
      },
      ping: async () => "PONG"
    };
    const redis = createRedisRuntimeStore({ client });
    const valkey = createValkeyRuntimeStore({ client });
    await expect(redis.consumeCounter({
      key: "counter",
      amount: 1,
      limit: 2,
      windowMs: 1000,
      nowMs: 0
    })).resolves.toMatchObject({ allowed: true, value: 1 });
    await expect(valkey.diagnostics()).resolves.toMatchObject({
      kind: "valkey",
      distributed: true,
      healthy: true
    });
    expect(calls).toHaveLength(1);
  });
});
