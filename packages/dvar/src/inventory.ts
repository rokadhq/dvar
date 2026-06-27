import { sha256 } from "./canonical.js";
import type {
  DvarInventory,
  DvarInventoryChange,
  DvarInventoryDiff,
  DvarInventoryServer,
  DvarInventoryTool,
  DvarLockfile,
  DvarMcpToolDefinition,
  DvarRiskLevel
} from "./types.js";

const RISK_ORDER: Record<DvarRiskLevel, number> = {
  informational: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function words(tool: DvarMcpToolDefinition): string {
  return `${tool.name} ${tool.title ?? ""} ${tool.description ?? ""}`.toLowerCase();
}

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

export function inferToolCapabilities(tool: DvarMcpToolDefinition): string[] {
  const text = words(tool);
  const capabilities: string[] = [];
  const annotations = tool.annotations ?? {};

  if (has(text, /\b(search|find|query|lookup)\b/u)) capabilities.push("data.search");
  if (has(text, /\b(read|get|list|fetch|inspect|view|describe)\b/u)) capabilities.push("data.read");
  if (has(text, /\b(create|add|insert|new|open)\b/u)) capabilities.push("data.create");
  if (has(text, /\b(update|edit|modify|set|write|patch)\b/u)) capabilities.push("data.update");
  if (has(text, /\b(delete|remove|destroy|drop|purge|terminate)\b/u)) capabilities.push("data.delete");
  if (has(text, /\b(export|dump|extract)\b/u)) capabilities.push("data.export");

  if (has(text, /\b(file|filesystem|directory|folder|path)\b/u)) {
    if (has(text, /\b(read|get|list|search|find)\b/u)) capabilities.push("filesystem.read");
    if (has(text, /\b(write|create|update|edit|move|copy)\b/u)) capabilities.push("filesystem.write");
    if (has(text, /\b(delete|remove|unlink)\b/u)) capabilities.push("filesystem.delete");
  }

  if (has(text, /\b(shell|terminal|command|exec|execute command|run command)\b/u)) capabilities.push("shell.execute");
  else if (has(text, /\b(execute|run code|evaluate code|compile)\b/u)) capabilities.push("code.execute");

  if (has(text, /\b(send|email|message|notify|publish|post)\b/u)) capabilities.push("communication.send");
  if (has(text, /\b(publish|broadcast|announce)\b/u)) capabilities.push("communication.publish");
  if (has(text, /\b(inbox|mail|messages|notifications)\b/u) && has(text, /\b(read|get|list|search)\b/u)) {
    capabilities.push("communication.read");
  }

  if (has(text, /\b(refund)\b/u)) capabilities.push("finance.refund");
  if (has(text, /\b(transfer|payout|withdraw)\b/u)) capabilities.push("finance.transfer");
  if (has(text, /\b(charge|payment|purchase|checkout|pay)\b/u)) capabilities.push("finance.charge");
  if (has(text, /\b(invoice|balance|transaction)\b/u) && has(text, /\b(read|get|list|search)\b/u)) {
    capabilities.push("finance.read");
  }

  if (has(text, /\b(secret|credential|token|api key|password)\b/u)) {
    if (has(text, /\b(read|get|list|reveal)\b/u)) capabilities.push("secrets.read");
    if (has(text, /\b(write|set|create|update|rotate)\b/u)) capabilities.push("secrets.write");
  }

  if (has(text, /\b(deploy|release|rollout)\b/u)) capabilities.push("infrastructure.deploy");
  if (has(text, /\b(infrastructure|server|cluster|service|instance|container|kubernetes)\b/u)) {
    if (has(text, /\b(read|get|list|inspect|status)\b/u)) capabilities.push("infrastructure.read");
    if (has(text, /\b(update|modify|scale|restart|configure)\b/u)) capabilities.push("infrastructure.modify");
    if (has(text, /\b(delete|destroy|terminate)\b/u)) capabilities.push("infrastructure.delete");
  }

  if (has(text, /\b(repository|repo|pull request|merge request|branch|commit|github|gitlab)\b/u)) {
    if (has(text, /\b(read|get|list|search|diff|inspect)\b/u)) capabilities.push("repository.read");
    if (has(text, /\b(create|write|push|update|edit|comment)\b/u)) capabilities.push("repository.write");
    if (has(text, /\b(merge)\b/u)) capabilities.push("repository.merge");
    if (has(text, /\b(admin|permission|protection|owner)\b/u)) capabilities.push("repository.admin");
  }

  if (has(text, /\b(user|member|identity|account|role|permission)\b/u)) {
    if (has(text, /\b(read|get|list|search)\b/u)) capabilities.push("identity.read");
    if (has(text, /\b(create|update|delete|manage|grant|revoke)\b/u)) capabilities.push("identity.manage");
    if (has(text, /\b(impersonate|assume identity|login as)\b/u)) capabilities.push("identity.impersonate");
  }

  if (has(text, /\b(browser|navigate|url|webpage|website)\b/u)) capabilities.push("browser.navigate");
  if (has(text, /\b(submit|form|click|type)\b/u)) capabilities.push("browser.submit");
  if (has(text, /\b(download)\b/u)) capabilities.push("browser.download");
  if (has(text, /\b(purchase|checkout|buy)\b/u)) capabilities.push("browser.purchase");

  if (has(text, /\b(admin|root|superuser|organization owner)\b/u)) capabilities.push("system.admin");

  if (annotations.destructiveHint === true && !capabilities.some((value) => value.endsWith(".delete"))) {
    capabilities.push("data.delete");
  }
  if (annotations.readOnlyHint === true && capabilities.length === 0) capabilities.push("data.read");
  if (capabilities.length === 0) capabilities.push("network.request");

  return uniqueSorted(capabilities);
}

export function riskForCapabilities(capabilities: string[], annotations?: Record<string, unknown>): DvarRiskLevel {
  const critical = new Set(["system.admin", "identity.impersonate", "infrastructure.delete"]);
  const high = new Set([
    "shell.execute",
    "code.execute",
    "finance.transfer",
    "finance.charge",
    "finance.refund",
    "identity.manage",
    "secrets.read",
    "secrets.write",
    "repository.admin",
    "browser.purchase",
    "data.delete",
    "filesystem.delete"
  ]);
  const medium = new Set([
    "data.create",
    "data.update",
    "data.export",
    "filesystem.write",
    "network.upload",
    "communication.send",
    "communication.publish",
    "infrastructure.deploy",
    "infrastructure.modify",
    "repository.write",
    "repository.merge",
    "browser.submit"
  ]);

  if (capabilities.some((value) => critical.has(value))) return "critical";
  if (capabilities.some((value) => high.has(value)) || annotations?.destructiveHint === true) return "high";
  if (capabilities.some((value) => medium.has(value)) || annotations?.openWorldHint === true) return "medium";
  if (capabilities.some((value) => value.endsWith(".read") || value.endsWith(".search"))) return "low";
  return "informational";
}

export function canonicalizeTool(
  tool: DvarMcpToolDefinition,
  capabilities = inferToolCapabilities(tool)
): DvarInventoryTool {
  const normalizedCapabilities = uniqueSorted(capabilities);
  const description = tool.description ?? "";
  const annotations = tool.annotations ?? {};
  const outputSchema = tool.outputSchema;
  const identity = {
    name: tool.name,
    title: tool.title ?? "",
    description,
    inputSchema: tool.inputSchema,
    outputSchema: outputSchema ?? null,
    annotations,
    capabilities: normalizedCapabilities
  };

  return {
    name: tool.name,
    ...(tool.title !== undefined ? { title: tool.title } : {}),
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    descriptionSha256: sha256(description),
    inputSchema: tool.inputSchema,
    inputSchemaSha256: sha256(tool.inputSchema),
    ...(outputSchema !== undefined
      ? { outputSchema, outputSchemaSha256: sha256(outputSchema) }
      : {}),
    ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
    annotationsSha256: sha256(annotations),
    capabilities: normalizedCapabilities,
    risk: riskForCapabilities(normalizedCapabilities, tool.annotations),
    definitionSha256: sha256(identity)
  };
}

export interface CreateServerInventoryInput {
  id: string;
  endpoint: string;
  protocolVersion?: string;
  serverInfo?: DvarInventoryServer["serverInfo"];
  advertisedCapabilities?: Record<string, unknown>;
  tools: DvarMcpToolDefinition[];
  classifications?: Record<string, string[]>;
}

export function createServerInventory(input: CreateServerInventoryInput): DvarInventoryServer {
  const tools = input.tools
    .map((tool) => canonicalizeTool(tool, input.classifications?.[tool.name]))
    .sort((left, right) => left.name.localeCompare(right.name));
  const manifest = {
    id: input.id,
    transport: "streamable-http",
    endpoint: input.endpoint,
    protocolVersion: input.protocolVersion ?? "",
    serverInfo: input.serverInfo ?? {},
    advertisedCapabilities: input.advertisedCapabilities ?? {},
    tools: tools.map((tool) => ({
      name: tool.name,
      definitionSha256: tool.definitionSha256,
      capabilities: tool.capabilities,
      risk: tool.risk
    }))
  };

  return {
    id: input.id,
    transport: "streamable-http",
    endpoint: input.endpoint,
    ...(input.protocolVersion !== undefined ? { protocolVersion: input.protocolVersion } : {}),
    ...(input.serverInfo !== undefined ? { serverInfo: input.serverInfo } : {}),
    ...(input.advertisedCapabilities !== undefined
      ? { advertisedCapabilities: input.advertisedCapabilities }
      : {}),
    identity: { type: "url", value: input.endpoint },
    integrity: { manifestSha256: sha256(manifest) },
    tools
  };
}

export function createInventory(servers: DvarInventoryServer[], generatedAt = new Date().toISOString()): DvarInventory {
  return {
    inventoryVersion: "1",
    generatedAt,
    servers: [...servers].sort((left, right) => left.id.localeCompare(right.id))
  };
}

export function inventoryToLockfile(inventory: DvarInventory): DvarLockfile {
  return {
    lockfileVersion: "1",
    generatedAt: inventory.generatedAt,
    servers: inventory.servers
  };
}

function schemaRelation(before: Record<string, unknown>, after: Record<string, unknown>): "same" | "widened" | "narrowed" | "changed" {
  if (sha256(before) === sha256(after)) return "same";
  const beforeType = before.type;
  const afterType = after.type;
  if (beforeType !== "object" || afterType !== "object") return "changed";

  const beforeProperties = (before.properties ?? {}) as Record<string, unknown>;
  const afterProperties = (after.properties ?? {}) as Record<string, unknown>;
  const beforeRequired = new Set(Array.isArray(before.required) ? before.required.filter((value): value is string => typeof value === "string") : []);
  const afterRequired = new Set(Array.isArray(after.required) ? after.required.filter((value): value is string => typeof value === "string") : []);
  const beforeNames = new Set(Object.keys(beforeProperties));
  const afterNames = new Set(Object.keys(afterProperties));

  const propertyAdded = [...afterNames].some((name) => !beforeNames.has(name));
  const propertyRemoved = [...beforeNames].some((name) => !afterNames.has(name));
  const requiredRemoved = [...beforeRequired].some((name) => !afterRequired.has(name));
  const requiredAdded = [...afterRequired].some((name) => !beforeRequired.has(name));
  const additionalWidened = before.additionalProperties === false && after.additionalProperties !== false;
  const additionalNarrowed = before.additionalProperties !== false && after.additionalProperties === false;

  const widened = propertyAdded || requiredRemoved || additionalWidened;
  const narrowed = propertyRemoved || requiredAdded || additionalNarrowed;
  if (widened && !narrowed) return "widened";
  if (narrowed && !widened) return "narrowed";
  return "changed";
}

function add(changes: DvarInventoryChange[], change: DvarInventoryChange): void {
  changes.push(change);
}

function changeRisk(type: DvarInventoryChange["type"], tool?: DvarInventoryTool): DvarRiskLevel {
  if (type === "server.endpoint_changed" || type === "tool.capability_expanded") return "critical";
  if (type === "server.added" || type === "server.integrity_changed" || type === "tool.input_schema_widened") return "high";
  if (type === "tool.added") return tool?.risk === "critical" ? "critical" : tool?.risk === "high" ? "high" : "medium";
  if (type === "tool.input_schema_changed" || type === "tool.output_schema_changed") return "high";
  if (type === "tool.description_changed" || type === "tool.annotations_changed" || type === "tool.input_schema_narrowed") return "medium";
  return "low";
}

function highest(changes: DvarInventoryChange[]): DvarRiskLevel {
  return changes.reduce<DvarRiskLevel>((current, change) =>
    RISK_ORDER[change.risk] > RISK_ORDER[current] ? change.risk : current, "informational");
}

export function diffInventory(lockfile: DvarLockfile, inventory: DvarInventory): DvarInventoryDiff {
  const changes: DvarInventoryChange[] = [];
  const lockedServers = new Map(lockfile.servers.map((server) => [server.id, server]));
  const observedServers = new Map(inventory.servers.map((server) => [server.id, server]));

  for (const [serverId, observed] of observedServers) {
    const locked = lockedServers.get(serverId);
    if (locked === undefined) {
      add(changes, {
        type: "server.added",
        serverId,
        risk: "high",
        reasonCode: "tool.unknown_server",
        message: `Server ${serverId} was added`,
        afterHash: observed.integrity.manifestSha256
      });
      continue;
    }
    if (locked.endpoint !== observed.endpoint) {
      add(changes, {
        type: "server.endpoint_changed",
        serverId,
        risk: "critical",
        reasonCode: "destination.changed",
        message: `Server ${serverId} endpoint changed`,
        ...(locked.endpoint !== undefined ? { beforeHash: sha256(locked.endpoint) } : {}),
        ...(observed.endpoint !== undefined ? { afterHash: sha256(observed.endpoint) } : {})
      });
    }

    const lockedTools = new Map(locked.tools.map((tool) => [tool.name, tool]));
    const observedTools = new Map(observed.tools.map((tool) => [tool.name, tool]));
    for (const [toolName, observedTool] of observedTools) {
      const lockedTool = lockedTools.get(toolName);
      if (lockedTool === undefined) {
        add(changes, {
          type: "tool.added",
          serverId,
          toolName,
          risk: changeRisk("tool.added", observedTool),
          reasonCode: "tool.unlocked",
          message: `Tool ${serverId}/${toolName} was added`,
          afterHash: observedTool.definitionSha256
        });
        continue;
      }
      if (lockedTool.descriptionSha256 !== observedTool.descriptionSha256) {
        add(changes, {
          type: "tool.description_changed",
          serverId,
          toolName,
          risk: "medium",
          reasonCode: "tool.description_changed",
          message: `Tool ${serverId}/${toolName} description changed`,
          beforeHash: lockedTool.descriptionSha256,
          afterHash: observedTool.descriptionSha256
        });
      }
      const relation = schemaRelation(lockedTool.inputSchema, observedTool.inputSchema);
      if (relation !== "same") {
        const type = relation === "widened"
          ? "tool.input_schema_widened"
          : relation === "narrowed"
            ? "tool.input_schema_narrowed"
            : "tool.input_schema_changed";
        add(changes, {
          type,
          serverId,
          toolName,
          risk: changeRisk(type),
          reasonCode: "tool.schema_changed",
          message: `Tool ${serverId}/${toolName} input schema ${relation}`,
          beforeHash: lockedTool.inputSchemaSha256,
          afterHash: observedTool.inputSchemaSha256
        });
      }
      if ((lockedTool.outputSchemaSha256 ?? "") !== (observedTool.outputSchemaSha256 ?? "")) {
        add(changes, {
          type: "tool.output_schema_changed",
          serverId,
          toolName,
          risk: "high",
          reasonCode: "tool.output_schema_changed",
          message: `Tool ${serverId}/${toolName} output schema changed`,
          ...(lockedTool.outputSchemaSha256 !== undefined ? { beforeHash: lockedTool.outputSchemaSha256 } : {}),
          ...(observedTool.outputSchemaSha256 !== undefined ? { afterHash: observedTool.outputSchemaSha256 } : {})
        });
      }
      if (lockedTool.annotationsSha256 !== observedTool.annotationsSha256) {
        add(changes, {
          type: "tool.annotations_changed",
          serverId,
          toolName,
          risk: "medium",
          reasonCode: "tool.annotations_changed",
          message: `Tool ${serverId}/${toolName} annotations changed`,
          beforeHash: lockedTool.annotationsSha256,
          afterHash: observedTool.annotationsSha256
        });
      }
      const lockedCapabilities = new Set(lockedTool.capabilities);
      const observedCapabilities = new Set(observedTool.capabilities);
      const expanded = [...observedCapabilities].filter((value) => !lockedCapabilities.has(value));
      const reduced = [...lockedCapabilities].filter((value) => !observedCapabilities.has(value));
      if (expanded.length > 0) {
        add(changes, {
          type: "tool.capability_expanded",
          serverId,
          toolName,
          risk: "critical",
          reasonCode: "tool.capability_expanded",
          message: `Tool ${serverId}/${toolName} gained capabilities: ${expanded.join(", ")}`,
          beforeHash: sha256(lockedTool.capabilities),
          afterHash: sha256(observedTool.capabilities)
        });
      }
      if (reduced.length > 0) {
        add(changes, {
          type: "tool.capability_reduced",
          serverId,
          toolName,
          risk: "low",
          reasonCode: "tool.capability_reduced",
          message: `Tool ${serverId}/${toolName} lost capabilities: ${reduced.join(", ")}`,
          beforeHash: sha256(lockedTool.capabilities),
          afterHash: sha256(observedTool.capabilities)
        });
      }
      if (lockedTool.risk !== observedTool.risk) {
        add(changes, {
          type: "tool.risk_changed",
          serverId,
          toolName,
          risk: RISK_ORDER[observedTool.risk] > RISK_ORDER[lockedTool.risk] ? "high" : "low",
          reasonCode: "tool.risk_changed",
          message: `Tool ${serverId}/${toolName} risk changed from ${lockedTool.risk} to ${observedTool.risk}`
        });
      }
    }
    for (const [toolName, lockedTool] of lockedTools) {
      if (!observedTools.has(toolName)) {
        add(changes, {
          type: "tool.removed",
          serverId,
          toolName,
          risk: "low",
          reasonCode: "tool.removed",
          message: `Tool ${serverId}/${toolName} was removed`,
          beforeHash: lockedTool.definitionSha256
        });
      }
    }
    if (locked.integrity.manifestSha256 !== observed.integrity.manifestSha256 && !changes.some((change) => change.serverId === serverId)) {
      add(changes, {
        type: "server.integrity_changed",
        serverId,
        risk: "high",
        reasonCode: "tool.manifest_changed",
        message: `Server ${serverId} manifest changed`,
        beforeHash: locked.integrity.manifestSha256,
        afterHash: observed.integrity.manifestSha256
      });
    }
  }

  for (const [serverId, locked] of lockedServers) {
    if (!observedServers.has(serverId)) {
      add(changes, {
        type: "server.removed",
        serverId,
        risk: "low",
        reasonCode: "tool.server_removed",
        message: `Server ${serverId} was removed`,
        beforeHash: locked.integrity.manifestSha256
      });
    }
  }

  changes.sort((left, right) =>
    RISK_ORDER[right.risk] - RISK_ORDER[left.risk]
    || left.serverId.localeCompare(right.serverId)
    || (left.toolName ?? "").localeCompare(right.toolName ?? "")
    || left.type.localeCompare(right.type));

  return { clean: changes.length === 0, highestRisk: highest(changes), changes };
}
