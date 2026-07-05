import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DvarConfigurationError } from "./errors.js";
import { inventoryToLockfile } from "./inventory.js";
import type { DvarInventory, DvarInventoryServer, DvarInventoryTool, DvarLockfile } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateTool(value: unknown, path: string): DvarInventoryTool {
  if (!isObject(value) || typeof value.name !== "string") {
    throw new DvarConfigurationError(`Invalid Dvar lockfile tool at ${path}`);
  }
  if (!isObject(value.inputSchema) || typeof value.inputSchemaSha256 !== "string") {
    throw new DvarConfigurationError(`Invalid input schema metadata at ${path}`);
  }
  if (!Array.isArray(value.capabilities) || !value.capabilities.every((item) => typeof item === "string")) {
    throw new DvarConfigurationError(`Invalid capability list at ${path}`);
  }
  return value as unknown as DvarInventoryTool;
}

function validateServer(value: unknown, index: number): DvarInventoryServer {
  if (!isObject(value) || typeof value.id !== "string" || !Array.isArray(value.tools)) {
    throw new DvarConfigurationError(`Invalid Dvar lockfile server at /servers/${index}`);
  }
  const server = value as unknown as DvarInventoryServer;
  server.tools.forEach((tool, toolIndex) => validateTool(tool, `/servers/${index}/tools/${toolIndex}`));
  if (!isObject(server.integrity) || typeof server.integrity.manifestSha256 !== "string") {
    throw new DvarConfigurationError(`Invalid server integrity at /servers/${index}`);
  }
  return server;
}

export function validateLockfile(input: unknown): DvarLockfile {
  if (!isObject(input) || input.lockfileVersion !== "1" || !Array.isArray(input.servers)) {
    throw new DvarConfigurationError("Dvar lockfile must declare lockfileVersion=1 and servers[]");
  }
  return {
    lockfileVersion: "1",
    generatedAt: typeof input.generatedAt === "string" ? input.generatedAt : null,
    servers: input.servers.map(validateServer)
  };
}

export async function loadLockfile(path = "dvar.lock.json"): Promise<DvarLockfile> {
  const absolutePath = resolve(path);
  let source: string;
  try {
    source = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new DvarConfigurationError(`Unable to read lockfile at ${absolutePath}`, [], { cause: error });
  }
  try {
    return validateLockfile(JSON.parse(source));
  } catch (error) {
    if (error instanceof DvarConfigurationError) throw error;
    throw new DvarConfigurationError(`Unable to parse lockfile at ${absolutePath}`, [], { cause: error });
  }
}

export async function writeLockfile(
  inventory: DvarInventory,
  path = "dvar.lock.json"
): Promise<DvarLockfile> {
  const lockfile = inventoryToLockfile(inventory);
  await writeFile(resolve(path), `${JSON.stringify(lockfile, null, 2)}\n`, "utf8");
  return lockfile;
}

export function findLockedServer(
  lockfile: DvarLockfile | undefined,
  serverId: string,
  endpoint?: string
): DvarInventoryServer | undefined {
  return lockfile?.servers.find((server) =>
    server.id === serverId || (endpoint !== undefined && server.endpoint === endpoint));
}

export function findLockedTool(
  lockfile: DvarLockfile | undefined,
  serverId: string,
  toolName: string,
  endpoint?: string
): DvarInventoryTool | undefined {
  return findLockedServer(lockfile, serverId, endpoint)?.tools.find((tool) => tool.name === toolName);
}
