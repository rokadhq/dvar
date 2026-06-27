import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import {
  DvarConfigurationError,
  createDvar,
  loadPolicy,
  runPolicyTests
} from "./index.js";
import type { DvarAction } from "./types.js";

const VERSION = "0.1.0-alpha.0";

const STARTER_POLICY = `schemaVersion: "1"
version: "0.1.0"
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
  dvar doctor [policy]
  dvar test-policy [policy] [--json]
  dvar replay <fixture.jsonl> [--policy dvar.yaml] [--json]
  dvar version
`;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function positional(args: string[]): string[] {
  const output: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === undefined) continue;
    if (value.startsWith("--")) {
      if (["--policy"].includes(value)) index += 1;
      continue;
    }
    output.push(value);
  }
  return output;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
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
  console.log("Run `dvar test-policy` before integrating the first tool.");
}

async function validate(args: string[]): Promise<void> {
  const path = positional(args)[0] ?? "dvar.yaml";
  const policy = await loadPolicy(path);
  console.log(`Valid Dvar policy: ${path}`);
  console.log(`schema=${policy.schemaVersion} mode=${policy.mode} rules=${policy.rules?.length ?? 0}`);
}

async function doctor(args: string[]): Promise<void> {
  const path = positional(args)[0] ?? "dvar.yaml";
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({ name: "Node.js", ok: major >= 20, detail: process.versions.node });
  try {
    const policy = await loadPolicy(path);
    checks.push({ name: "Policy", ok: true, detail: `${path} (${policy.mode})` });
  } catch (error) {
    checks.push({ name: "Policy", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  checks.push({
    name: "Lockfile",
    ok: await exists(resolve("dvar.lock.json")),
    detail: "dvar.lock.json (optional until MCP inventory support lands)"
  });
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }
  if (checks.some((check) => !check.ok && check.name !== "Lockfile")) process.exitCode = 1;
}

async function testPolicy(args: string[]): Promise<void> {
  const path = positional(args)[0] ?? "dvar.yaml";
  const policy = await loadPolicy(path);
  const results = await runPolicyTests(policy);
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
  const candidate = "action" in record
    ? (record as { action: unknown }).action
    : record;
  if (candidate === null || typeof candidate !== "object") {
    throw new DvarConfigurationError(`Replay line ${line} does not contain an action object`);
  }
  return candidate as DvarAction;
}

async function replay(args: string[]): Promise<void> {
  const fixturePath = positional(args)[0];
  if (fixturePath === undefined) throw new DvarConfigurationError("replay requires a JSONL fixture path");
  const policyPath = flagValue(args, "--policy") ?? "dvar.yaml";
  const runtime = await createDvar({ policyPath });
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
  if (args.includes("--json")) {
    console.log(JSON.stringify(decisions, null, 2));
  } else {
    for (const decision of decisions) {
      console.log(`${decision.effect.padEnd(18)} ${decision.ruleId} ${decision.reasonCode}`);
    }
    console.log(`${decisions.length} action(s) replayed; no tools were executed`);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "init": await init(args); break;
    case "validate": await validate(args); break;
    case "doctor": await doctor(args); break;
    case "test-policy": await testPolicy(args); break;
    case "replay": await replay(args); break;
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
