import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInventory,
  createServerInventory,
  findLockedServer,
  findLockedTool,
  loadLockfile,
  validateLockfile,
  writeLockfile
} from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  while (directories.length > 0) await rm(directories.pop()!, { recursive: true, force: true });
});

function inventory() {
  return createInventory([createServerInventory({
    id: "mock",
    endpoint: "https://mcp.example.test/mcp",
    tools: [{ name: "records.list", inputSchema: { type: "object" } }]
  })]);
}

describe("Dvar lockfile", () => {
  it("writes, loads, and resolves reviewed tools by id or endpoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dvar-lock-"));
    directories.push(directory);
    const path = join(directory, "dvar.lock.json");
    const written = await writeLockfile(inventory(), path);
    const loaded = await loadLockfile(path);
    expect(loaded).toEqual(written);
    expect(findLockedServer(loaded, "unknown", "https://mcp.example.test/mcp")?.id).toBe("mock");
    expect(findLockedTool(loaded, "mock", "records.list")?.name).toBe("records.list");
    expect(findLockedTool(loaded, "mock", "missing")).toBeUndefined();
  });

  it("rejects malformed lockfile roots and nested records", () => {
    expect(() => validateLockfile({})).toThrow(/lockfileVersion=1/u);
    expect(() => validateLockfile({ lockfileVersion: "1", servers: [{}] })).toThrow(/server/u);
    const valid = JSON.parse(JSON.stringify({
      lockfileVersion: "1",
      generatedAt: null,
      servers: inventory().servers
    })) as { servers: Array<Record<string, unknown>> };
    valid.servers[0]!.tools = [{}];
    expect(() => validateLockfile(valid)).toThrow(/tool/u);
  });

  it("reports unreadable and invalid JSON lockfiles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dvar-lock-invalid-"));
    directories.push(directory);
    await expect(loadLockfile(join(directory, "missing.json"))).rejects.toThrow(/Unable to read/u);
    const path = join(directory, "invalid.json");
    await writeFile(path, "{", "utf8");
    await expect(loadLockfile(path)).rejects.toThrow(/Unable to parse/u);
  });
});
