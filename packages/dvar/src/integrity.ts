import { findLockedServer, findLockedTool } from "./lockfile.js";
import type {
  DvarAction,
  DvarEffect,
  DvarIntegrityPolicy,
  DvarLockfile,
  DvarPolicy
} from "./types.js";

export interface DvarGuardrailResult {
  effect: Exclude<DvarEffect, "allow">;
  ruleId: string;
  reasonCode: string;
  message: string;
}

function configuredResult(
  effect: DvarEffect | undefined,
  strict: boolean,
  ruleId: string,
  reasonCode: string,
  message: string
): DvarGuardrailResult | undefined {
  const resolved = effect ?? (strict ? "deny" : undefined);
  if (resolved === undefined || resolved === "allow") return undefined;
  return { effect: resolved, ruleId, reasonCode, message };
}

function expansion(observed: string[] | undefined, locked: string[]): string[] {
  const approved = new Set(locked);
  return (observed ?? []).filter((capability) => !approved.has(capability));
}

export function evaluateIntegrity(
  dvarPolicy: DvarPolicy,
  lockfile: DvarLockfile | undefined,
  action: DvarAction
): DvarGuardrailResult | undefined {
  const policy: DvarIntegrityPolicy | undefined = dvarPolicy.integrity;
  if (policy === undefined) return undefined;
  const strict = dvarPolicy.mode === "strict";
  if (lockfile === undefined) {
    if (policy.requireLockfile === true) {
      return {
        effect: "deny",
        ruleId: "system.lockfile_required",
        reasonCode: "tool.lockfile_missing",
        message: "Dvar policy requires dvar.lock.json, but no lockfile was loaded"
      };
    }
    return undefined;
  }

  const server = findLockedServer(lockfile, action.server.id, action.server.endpoint);
  if (server === undefined) {
    return configuredResult(
      policy.onUnknownServer,
      strict,
      "system.unknown_server",
      "tool.unknown_server",
      `Server ${action.server.id} is not present in dvar.lock.json`
    );
  }

  if (action.server.endpoint !== undefined && server.endpoint !== undefined && action.server.endpoint !== server.endpoint) {
    return configuredResult(
      policy.onUnknownServer,
      strict,
      "system.server_endpoint_changed",
      "destination.changed",
      `Server ${action.server.id} endpoint differs from dvar.lock.json`
    );
  }

  const tool = findLockedTool(lockfile, server.id, action.tool.name, action.server.endpoint);
  if (tool === undefined) {
    return configuredResult(
      policy.onUnknownTool,
      strict,
      "system.unknown_tool",
      "tool.unlocked",
      `Tool ${server.id}/${action.tool.name} is not present in dvar.lock.json`
    );
  }

  if (action.tool.schemaHash !== undefined && action.tool.schemaHash !== tool.inputSchemaSha256) {
    return configuredResult(
      policy.onSchemaChange,
      strict,
      "system.tool_schema_changed",
      "tool.schema_changed",
      `Tool ${server.id}/${action.tool.name} input schema differs from dvar.lock.json`
    );
  }

  if (action.tool.outputSchemaHash !== undefined && action.tool.outputSchemaHash !== (tool.outputSchemaSha256 ?? "")) {
    return configuredResult(
      policy.onSchemaChange,
      strict,
      "system.tool_output_schema_changed",
      "tool.output_schema_changed",
      `Tool ${server.id}/${action.tool.name} output schema differs from dvar.lock.json`
    );
  }

  if (action.tool.descriptionHash !== undefined && action.tool.descriptionHash !== tool.descriptionSha256) {
    return configuredResult(
      policy.onDescriptionChange,
      strict,
      "system.tool_description_changed",
      "tool.description_changed",
      `Tool ${server.id}/${action.tool.name} description differs from dvar.lock.json`
    );
  }

  if (action.tool.annotationsHash !== undefined && action.tool.annotationsHash !== tool.annotationsSha256) {
    return configuredResult(
      policy.onDescriptionChange,
      strict,
      "system.tool_annotations_changed",
      "tool.annotations_changed",
      `Tool ${server.id}/${action.tool.name} annotations differs from dvar.lock.json`
    );
  }

  const addedCapabilities = expansion(action.tool.capabilities, tool.capabilities);
  if (addedCapabilities.length > 0) {
    return configuredResult(
      policy.onCapabilityExpansion,
      strict,
      "system.tool_capability_expanded",
      "tool.capability_expanded",
      `Tool ${server.id}/${action.tool.name} has unapproved capabilities: ${addedCapabilities.join(", ")}`
    );
  }

  return undefined;
}
