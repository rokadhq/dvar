import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { DvarConfigurationError } from "../errors.js";
import type { DvarPolicy } from "../types.js";
import { DVAR_POLICY_SCHEMA } from "./schema.js";

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validatePolicySchema = ajv.compile(DVAR_POLICY_SCHEMA);

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath.length > 0 ? error.instancePath : "/";
    return `${location} ${error.message ?? "is invalid"}`;
  });
}

function semanticDiagnostics(policy: DvarPolicy): string[] {
  const diagnostics: string[] = [];
  const ids = new Set<string>();
  for (const rule of policy.rules ?? []) {
    if (ids.has(rule.id)) diagnostics.push(`Duplicate rule id: ${rule.id}`);
    ids.add(rule.id);
    if (rule.effect === "require_approval" && rule.approval === undefined) {
      diagnostics.push(`Approval rule ${rule.id} must declare an approval block`);
    }
  }
  return diagnostics;
}

export function validatePolicy(input: unknown): DvarPolicy {
  if (!validatePolicySchema(input)) {
    throw new DvarConfigurationError("Dvar policy failed schema validation", formatErrors(validatePolicySchema.errors));
  }
  const policy = input as DvarPolicy;
  const diagnostics = semanticDiagnostics(policy);
  if (diagnostics.length > 0) {
    throw new DvarConfigurationError("Dvar policy failed semantic validation", diagnostics);
  }
  return policy;
}

export async function loadPolicy(path = "dvar.yaml"): Promise<DvarPolicy> {
  const absolutePath = resolve(path);
  let source: string;
  try {
    source = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new DvarConfigurationError(`Unable to read policy at ${absolutePath}`, [], { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = extname(absolutePath).toLowerCase() === ".json" ? JSON.parse(source) : parse(source);
  } catch (error) {
    throw new DvarConfigurationError(`Unable to parse policy at ${absolutePath}`, [], { cause: error });
  }

  return validatePolicy(parsed);
}
