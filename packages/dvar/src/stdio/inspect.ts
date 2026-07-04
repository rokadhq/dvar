import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, parse, sep } from "node:path";
import type { DvarExecutableIdentity, DvarPackageIntegrity } from "./types.js";

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function parent(path: string): string | undefined {
  const next = dirname(path);
  return next === path ? undefined : next;
}

function packageLockKeys(packageName: string | undefined, packageRoot: string): string[] {
  if (packageName === undefined) return [];
  const parsed = parse(packageRoot);
  const parts = packageRoot.split(sep);
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  const keys = [`node_modules/${packageName}`];
  if (nodeModulesIndex >= 0) {
    const suffix = parts.slice(nodeModulesIndex).join("/");
    keys.push(suffix);
  }
  if (parsed.base === packageName) keys.push("");
  return [...new Set(keys)];
}

async function packageIntegrity(start: string): Promise<DvarPackageIntegrity> {
  let cursor: string | undefined = start;
  let packageJsonPath: string | undefined;
  let packageRoot: string | undefined;
  let packageName: string | undefined;
  let packageVersion: string | undefined;

  while (cursor !== undefined) {
    const candidate = join(cursor, "package.json");
    const json = await readJson(candidate);
    if (json !== undefined && typeof json === "object" && json !== null) {
      const record = json as Record<string, unknown>;
      packageJsonPath = candidate;
      packageRoot = cursor;
      packageName = typeof record.name === "string" ? record.name : undefined;
      packageVersion = typeof record.version === "string" ? record.version : undefined;
      break;
    }
    cursor = parent(cursor);
  }

  let packageLockPath: string | undefined;
  let packageLockIntegrity: string | undefined;
  cursor = packageRoot;
  while (cursor !== undefined) {
    const candidate = join(cursor, "package-lock.json");
    const lock = await readJson(candidate);
    if (lock !== undefined && typeof lock === "object" && lock !== null) {
      packageLockPath = candidate;
      const packages = (lock as { packages?: unknown }).packages;
      if (packages !== undefined && typeof packages === "object" && packages !== null) {
        for (const key of packageLockKeys(packageName, packageRoot ?? start)) {
          const entry = (packages as Record<string, unknown>)[key];
          if (entry !== undefined && typeof entry === "object" && entry !== null) {
            const integrity = (entry as Record<string, unknown>).integrity;
            if (typeof integrity === "string") {
              packageLockIntegrity = integrity;
              break;
            }
          }
        }
      }
      break;
    }
    cursor = parent(cursor);
  }

  return {
    ...(packageJsonPath !== undefined ? { packageJsonPath } : {}),
    ...(packageName !== undefined ? { packageName } : {}),
    ...(packageVersion !== undefined ? { packageVersion } : {}),
    ...(packageLockPath !== undefined ? { packageLockPath } : {}),
    ...(packageLockIntegrity !== undefined ? { packageLockIntegrity } : {})
  };
}

export async function inspectExecutable(command: string): Promise<DvarExecutableIdentity> {
  const resolved = await realpath(command);
  const metadata = await stat(resolved);
  if (!metadata.isFile()) throw new Error(`Executable is not a regular file: ${command}`);
  const integrity = await packageIntegrity(dirname(resolved));
  return {
    command,
    realpath: resolved,
    sha256: await sha256File(resolved),
    sizeBytes: metadata.size,
    mode: metadata.mode,
    mtimeMs: metadata.mtimeMs,
    ...integrity
  };
}
