import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import {
  DvarConfigurationError,
  createDvar,
  createMcpHttpProxy,
  diffInventory,
  loadLockfile,
  loadPolicy,
  runPolicyTests,
  scanMcpServer,
  writeLockfile
} from "./index.js";
import type { DvarAction, DvarInventory } from "./types.js";

const VERSION = "0.2.0-alpha.0";

const STARTER_POLICY = `schemaVersion: "1"
version: "0.2.0"
mode: monitor
defaultEffect: deny

runtime:
  onEvaluationError: deny
  onDecisionTimeout: deny
  maxDecisionMs: 10
  maxToolCallsPerTask: 40
  maxDepth: 8

identity:
  require:
    - principal.id
    - agent.id
    - environment

integrity:
  requireLockfile: false
  onUnknownServer: deny
  onUnknownTool: require_approval
  onDescriptionChange: require_approval
  onSchemaChange: deny
  onCapabilityExpansion: deny

rules:
  - id: example.read-only
    priority: 100
    effect: allow
    when:
      tool.capabilities:
        containsAny:
          - data.read
          - data.search

  - id: deny-destructive-production
    priority: 1000
    effect: deny
    when:
      environment: production
      tool.capabilities:
        containsAny:
          - data.delete
          - infrastructure.delete
          - system.admin

tests:
  - name: read-only action is allowed
    action:
      principal.id: user-1
      principal.type: user
      agent.id: example-agent
      environment: development
      server.id: local
      tool.name: records.search
      tool.capabilities:
        - data.search
      arguments:
        query: hello
    expect:
      effect: allow
      ruleId: example.read-only

  - name: destructive production action is denied
    action:
      principal.id: user-1
      principal.type: user
      agent.id: example-agent
      environment: production
      server.id: local
      tool.name: records.delete
      tool.capabilities:
        - data.delete
      arguments:
        id: record-1
    expect:
      effect: deny
      ruleId: deny-destructive-production
`;

const EMPTY_LOCKFILE = `${JSON.stringify({
  lockfileVersion: "1",
  generatedAt: null,
  servers: []
}, null, 2)}\n`;

function usage(): string {
  return `Dvar ${VERSION} — policy firewall for AI agents

Usage:
  dvar init [--force]
  dvar validate [policy]
  dvar doctor [policy] [--lockfile dvar.lock.json]
  dvar scan <upstream> [--server-id id] [--out dvar.inventory.json]
            [--header "Name: value"] [--allow-insecure-http]
  dvar inspect <upstream> [scan options]
  dvar lock [inventory] [--out dvar.lock.json]
  dvar diff [inventory] [--lockfile dvar.lock.json] [--json]
  dvar test-policy [policy] [--lockfile dvar.lock.json] [--json]
  dvar replay <fixture.jsonl> [--policy dvar.yaml] [--lockfile dvar.lock.json] [--json]
  dvar proxy --upstream <url> [--listen 127.0.0.1:4319]
             [--policy dvar.yaml] [--lockfile dvar.lock.json]
             [--server-id id] [--upstream-header "Name: value"]
             [--allow-insecure-http] [--forward-authorization] [--no-preflight]
  dvar version
`;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function flagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] !== undefined) {
      values.push(args[index + 1] as string);
      index += 1;
    }
  }
  return values;
}

const VALUE_FLAGS = new Set([
  "--policy",
  "--lockfile",
  "--out",
  "--server-id",
  "--header",
  "--upstream",
  "--listen",
  "--upstream-header"
]);

function positional(args: string[]): string[] {
  const output: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === undefined) continue;
    if (value.startsWith("--")) {
      if (VALUE_FLAGS.has(value)) index += 1;
      continue;
    }
    output.push(value);
  }
  return output;
}

function parseHeaders(values: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf(":");
    if (separator <= 0) throw new DvarConfigurationError(`Invalid header syntax: ${value}`);
    const name = value.slice(0, separator).trim();
    const headerValue = value.slice(separator + 1).trim();
    if (name === "" || headerValue === "") throw new DvarConfigurationError(`Invalid header syntax: ${value}`);
    headers[name] = headerValue;
  }
  return headers;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readInventory(path: string): Promise<DvarInventory> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    throw new DvarConfigurationError(`Unable to read inventory at ${resolve(path)}`, [], { cause: error });
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new DvarConfigurationError("Dvar inventory must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  if (record.inventoryVersion !== "1" || !Array.isArray(record.servers) || typeof record.generatedAt !== "string") {
    throw new DvarConfigurationError("Dvar inventory must declare inventoryVersion=1, generatedAt, and servers[]");
  }
  return parsed as DvarInventory;
}

async function init(args: string[]): Promise<void> {
  const force = args.includes("--force");
  const policyPath = resolve("dvar.yaml");
  const lockPath = resolve("dvar.lock.json");
  for (const path of [policyPath, lockPath]) {
    if (!force && await exists(path)) {
      throw new DvarConfigurationError(`${path} already exists; use --force to replace it`);
    }
  }
  await writeFile(policyPath, STARTER_POLICY, "utf8");
  await writeFile(lockPath, EMPTY_LOCKFILE, "utf8");
  console.log("Created dvar.yaml and dvar.lock.json");
  console.log("Run `dvar test-policy`, then `dvar scan <mcp-url>` before enabling integrity enforcement.");
}

async function validate(args: string[]): Promise<void> {
  const path = positional(args)[0] ?? "dvar.yaml";
  const policy = await loadPolicy(path);
  console.log(`Valid Dvar policy: ${path}`);
  console.log(`schema=${policy.schemaVersion} mode=${policy.mode} rules=${policy.rules?.length ?? 0}`);
}

async function doctor(args: string[]): Promise<void> {
  const path = positional(args)[0] ?? "dvar.yaml";
  const lockPath = flagValue(args, "--lockfile") ?? "dvar.lock.json";
  const checks: Array<{ name: string; ok: boolean; detail: string; required?: boolean }> = [];
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({ name: "Node.js", ok: major >= 20, detail: process.versions.node, required: true });
  let lockRequired = false;
  try {
    const policy = await loadPolicy(path);
    lockRequired = policy.integrity?.requireLockfile === true;
    checks.push({ name: "Policy", ok: true, detail: `${path} (${policy.mode})`, required: true });
  } catch (error) {
    checks.push({ name: "Policy", ok: false, detail: error instanceof Error ? error.message : String(error), required: true });
  }
  if (await exists(resolve(lockPath))) {
    try {
      const lockfile = await loadLockfile(lockPath);
      checks.push({ name: "Lockfile", ok: true, detail: `${lockPath} (${lockfile.servers.length} server(s))`, required: lockRequired });
    } catch (error) {
      checks.push({ name: "Lockfile", ok: false, detail: error instanceof Error ? error.message : String(error), required: true });
    }
  } else {
    checks.push({ name: "Lockfile", ok: false, detail: `${lockPath} not found`, required: lockRequired });
  }
  for (const check of checks) console.log(`${check.ok ? "PASS" : check.required ? "FAIL" : "WARN"} ${check.name}: ${check.detail}`);
  if (checks.some((check) => check.required === true && !check.ok)) process.exitCode = 1;
}

async function scan(args: string[], printOnly = false): Promise<void> {
  const endpoint = positional(args)[0];
  if (endpoint === undefined) throw new DvarConfigurationError("scan requires an MCP Streamable HTTP endpoint");
  const serverId = flagValue(args, "--server-id");
  const inventory = await scanMcpServer({
    endpoint,
    ...(serverId !== undefined ? { serverId } : {}),
    headers: parseHeaders(flagValues(args, "--header")),
    allowInsecureHttp: args.includes("--allow-insecure-http")
  });
  const encoded = `${JSON.stringify(inventory, null, 2)}\n`;
  if (printOnly || flagValue(args, "--out") === "-") {
    process.stdout.write(encoded);
    return;
  }
  const out = flagValue(args, "--out") ?? "dvar.inventory.json";
  await writeFile(resolve(out), encoded, "utf8");
  const toolCount = inventory.servers.reduce((total, server) => total + server.tools.length, 0);
  console.log(`Scanned ${inventory.servers.length} MCP server(s), discovered ${toolCount} tool(s), wrote ${out}`);
}

async function lock(args: string[]): Promise<void> {
  const inventoryPath = positional(args)[0] ?? "dvar.inventory.json";
  const out = flagValue(args, "--out") ?? "dvar.lock.json";
  const inventory = await readInventory(inventoryPath);
  const lockfile = await writeLockfile(inventory, out);
  const toolCount = lockfile.servers.reduce((total, server) => total + server.tools.length, 0);
  console.log(`Locked ${lockfile.servers.length} server(s) and ${toolCount} tool(s) in ${out}`);
}

async function diff(args: string[]): Promise<void> {
  const inventoryPath = positional(args)[0] ?? "dvar.inventory.json";
  const lockPath = flagValue(args, "--lockfile") ?? "dvar.lock.json";
  const result = diffInventory(await loadLockfile(lockPath), await readInventory(inventoryPath));
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.clean) {
    console.log("No MCP inventory changes detected");
  } else {
    for (const change of result.changes) {
      console.log(`${change.risk.toUpperCase().padEnd(13)} ${change.type.padEnd(30)} ${change.serverId}${change.toolName === undefined ? "" : `/${change.toolName}`}`);
      console.log(`  ${change.message}`);
    }
    console.log(`${result.changes.length} change(s); highest risk=${result.highestRisk}`);
  }
  if (!result.clean) process.exitCode = 2;
}

async function testPolicy(args: string[]): Promise<void> {
  const path = positional(args)[0] ?? "dvar.yaml";
  const policy = await loadPolicy(path);
  const configuredLockPath = flagValue(args, "--lockfile");
  const defaultLockPath = resolve("dvar.lock.json");
  const lockfile = configuredLockPath !== undefined
    ? await loadLockfile(configuredLockPath)
    : policy.integrity?.requireLockfile === true && await exists(defaultLockPath)
      ? await loadLockfile(defaultLockPath)
      : undefined;
  const results = await runPolicyTests(
    policy,
    lockfile !== undefined ? { lockfile } : {}
  );
  if (args.includes("--json")) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}`);
      if (!result.passed) {
        console.log(`  expected=${JSON.stringify(result.expected)}`);
        console.log(`  actual=${JSON.stringify(result.decision ?? result.error)}`);
      }
    }
    console.log(`${results.filter((result) => result.passed).length}/${results.length} policy tests passed`);
  }
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

function asAction(record: unknown, line: number): DvarAction {
  if (record === null || typeof record !== "object") {
    throw new DvarConfigurationError(`Replay line ${line} is not an object`);
  }
  const candidate = "action" in record ? (record as { action: unknown }).action : record;
  if (candidate === null || typeof candidate !== "object") {
    throw new DvarConfigurationError(`Replay line ${line} does not contain an action object`);
  }
  return candidate as DvarAction;
}

async function replay(args: string[]): Promise<void> {
  const fixturePath = positional(args)[0];
  if (fixturePath === undefined) throw new DvarConfigurationError("replay requires a JSONL fixture path");
  const policyPath = flagValue(args, "--policy") ?? "dvar.yaml";
  const lockPath = flagValue(args, "--lockfile");
  const runtime = await createDvar({
    policyPath,
    ...(lockPath !== undefined ? { lockfilePath: lockPath } : {})
  });
  const source = await readFile(resolve(fixturePath), "utf8");
  const decisions = [];
  const lines = source.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  for (const [index, line] of lines.entries()) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new DvarConfigurationError(`Replay line ${index + 1} is invalid JSON`, [], { cause: error });
    }
    decisions.push(await runtime.evaluate(asAction(record, index + 1)));
  }
  if (args.includes("--json")) console.log(JSON.stringify(decisions, null, 2));
  else {
    for (const decision of decisions) console.log(`${decision.effect.padEnd(18)} ${decision.ruleId} ${decision.reasonCode}`);
    console.log(`${decisions.length} action(s) replayed; no tools were executed`);
  }
}

function listenAddress(value: string): { host: string; port: number } {
  const separator = value.lastIndexOf(":");
  if (separator <= 0) throw new DvarConfigurationError(`Invalid listen address: ${value}`);
  const host = value.slice(0, separator);
  const port = Number.parseInt(value.slice(separator + 1), 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new DvarConfigurationError(`Invalid listen port: ${value}`);
  return { host, port };
}

async function proxy(args: string[]): Promise<void> {
  const upstream = flagValue(args, "--upstream") ?? positional(args)[0];
  if (upstream === undefined) throw new DvarConfigurationError("proxy requires --upstream <url>");
  const policyPath = flagValue(args, "--policy") ?? "dvar.yaml";
  const lockPath = flagValue(args, "--lockfile") ?? "dvar.lock.json";
  const runtime = await createDvar({
    policyPath,
    ...(await exists(resolve(lockPath)) ? { lockfilePath: lockPath } : {})
  });
  const serverId = flagValue(args, "--server-id");
  const upstreamHeaders = parseHeaders(flagValues(args, "--upstream-header"));
  const allowInsecureHttp = args.includes("--allow-insecure-http");
  const inventory = args.includes("--no-preflight")
    ? undefined
    : await scanMcpServer({
        endpoint: upstream,
        ...(serverId !== undefined ? { serverId } : {}),
        headers: upstreamHeaders,
        allowInsecureHttp
      });
  if (inventory !== undefined && runtime.lockfile !== undefined) {
    const preflightDiff = diffInventory(runtime.lockfile, inventory);
    if (!preflightDiff.clean) {
      console.error(`Dvar preflight detected ${preflightDiff.changes.length} MCP inventory change(s); highest risk=${preflightDiff.highestRisk}`);
      for (const change of preflightDiff.changes) {
        console.error(`  ${change.risk.toUpperCase()} ${change.type} ${change.serverId}${change.toolName === undefined ? "" : `/${change.toolName}`}`);
      }
    }
  }
  const mcpProxy = createMcpHttpProxy({
    upstream,
    runtime,
    ...(serverId !== undefined ? { serverId } : {}),
    ...(inventory !== undefined ? { inventory } : {}),
    upstreamHeaders,
    allowInsecureHttp,
    forwardAuthorization: args.includes("--forward-authorization")
  });
  const address = await mcpProxy.listen(listenAddress(flagValue(args, "--listen") ?? "127.0.0.1:4319"));
  console.log(`Dvar MCP proxy listening on http://${address.host}:${address.port}`);
  console.log(`Upstream: ${upstream}`);
  await new Promise<void>((resolvePromise) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void mcpProxy.close().finally(resolvePromise);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "init": await init(args); break;
    case "validate": await validate(args); break;
    case "doctor": await doctor(args); break;
    case "scan": await scan(args); break;
    case "inspect": await scan(args, true); break;
    case "lock": await lock(args); break;
    case "diff": await diff(args); break;
    case "test-policy": await testPolicy(args); break;
    case "replay": await replay(args); break;
    case "proxy": await proxy(args); break;
    case "version": case "--version": case "-v": console.log(VERSION); break;
    case "help": case "--help": case "-h": case undefined: console.log(usage()); break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(usage());
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  if (error instanceof DvarConfigurationError) {
    console.error(`Dvar configuration error: ${error.message}`);
    for (const diagnostic of error.diagnostics) console.error(`  - ${diagnostic}`);
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  process.exitCode = 1;
});
