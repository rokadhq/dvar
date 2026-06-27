import { DvarConfigurationError } from "../errors.js";
import { createInventory, createServerInventory } from "../inventory.js";
import { sha256 } from "../canonical.js";
import type {
  DvarInventory,
  DvarMcpScanOptions,
  DvarMcpToolDefinition
} from "../types.js";

const DEFAULT_PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_TIMEOUT_MS = 15_000;
const FORBIDDEN_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "mcp-protocol-version",
  "mcp-session-id",
  "transfer-encoding"
]);

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface InitializeResult {
  protocolVersion?: string;
  capabilities?: Record<string, unknown>;
  serverInfo?: { name?: string; version?: string; [key: string]: unknown };
}

function safeHeaders(headers: Record<string, string> | undefined): Headers {
  const output = new Headers();
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.toLowerCase();
    if (FORBIDDEN_HEADERS.has(normalized)) {
      throw new DvarConfigurationError(`Header ${name} is controlled by Dvar and cannot be overridden`);
    }
    if (/\r|\n/u.test(name) || /\r|\n/u.test(value)) {
      throw new DvarConfigurationError(`Header ${name} contains a prohibited newline`);
    }
    output.set(name, value);
  }
  return output;
}

export function validateMcpEndpoint(
  endpoint: string | URL,
  allowInsecureHttp = false
): URL {
  const url = endpoint instanceof URL ? new URL(endpoint) : new URL(endpoint);
  if (url.username !== "" || url.password !== "") {
    throw new DvarConfigurationError("MCP endpoint must not contain embedded credentials");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DvarConfigurationError("MCP endpoint must use http or https");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  if (url.protocol === "http:" && !allowInsecureHttp && !local) {
    throw new DvarConfigurationError("Plain HTTP MCP endpoints are only allowed for localhost unless allowInsecureHttp is enabled");
  }
  return url;
}

function parseSse(source: string): unknown[] {
  const events: unknown[] = [];
  let data: string[] = [];
  const flush = (): void => {
    if (data.length === 0) return;
    const payload = data.join("\n");
    data = [];
    try {
      events.push(JSON.parse(payload));
    } catch {
      // Ignore non-JSON SSE events; MCP JSON-RPC responses remain discoverable.
    }
  };
  for (const line of source.split(/\r?\n/u)) {
    if (line === "") {
      flush();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }
  flush();
  return events;
}

export async function parseMcpResponseMessages(response: Response): Promise<unknown[]> {
  if (response.status === 202 || response.status === 204) return [];
  const text = await response.text();
  if (text.trim() === "") return [];
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/event-stream")) return parseSse(text);
  const parsed = JSON.parse(text) as unknown;
  return Array.isArray(parsed) ? parsed : [parsed];
}

function rpcResponse(messages: unknown[], id: number): JsonRpcResponse {
  const response = messages.find((message) => {
    if (message === null || typeof message !== "object") return false;
    return (message as { id?: unknown }).id === id;
  });
  if (response === undefined) {
    throw new DvarConfigurationError(`MCP server did not return JSON-RPC response id ${id}`);
  }
  return response as JsonRpcResponse;
}

function sanitizeServerId(url: URL): string {
  const base = url.hostname.replace(/[^a-zA-Z0-9._-]/gu, "-") || "mcp-server";
  return `${base}-${sha256(url.toString()).slice(0, 8)}`;
}

function toolDefinition(value: unknown, index: number): DvarMcpToolDefinition {
  if (value === null || typeof value !== "object") {
    throw new DvarConfigurationError(`MCP tools/list item ${index} is not an object`);
  }
  const tool = value as Record<string, unknown>;
  if (typeof tool.name !== "string" || tool.name.length === 0) {
    throw new DvarConfigurationError(`MCP tools/list item ${index} has no valid name`);
  }
  if (tool.inputSchema === null || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) {
    throw new DvarConfigurationError(`MCP tool ${tool.name} has no valid inputSchema`);
  }
  return {
    name: tool.name,
    ...(typeof tool.title === "string" ? { title: tool.title } : {}),
    ...(typeof tool.description === "string" ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema as Record<string, unknown>,
    ...(tool.outputSchema !== null && typeof tool.outputSchema === "object" && !Array.isArray(tool.outputSchema)
      ? { outputSchema: tool.outputSchema as Record<string, unknown> }
      : {}),
    ...(tool.annotations !== null && typeof tool.annotations === "object" && !Array.isArray(tool.annotations)
      ? { annotations: tool.annotations as Record<string, unknown> }
      : {}),
    ...(tool._meta !== null && typeof tool._meta === "object" && !Array.isArray(tool._meta)
      ? { _meta: tool._meta as Record<string, unknown> }
      : {})
  };
}

export class DvarMcpHttpClient {
  readonly endpoint: URL;
  readonly protocolVersion: string;
  readonly timeoutMs: number;
  readonly fetchFn: typeof globalThis.fetch;
  private readonly baseHeaders: Headers;
  private sessionId: string | undefined;
  private requestId = 0;
  private initialized = false;
  private negotiatedVersion: string | undefined;
  private initializeResult?: InitializeResult;

  public constructor(options: DvarMcpScanOptions) {
    this.endpoint = validateMcpEndpoint(options.endpoint, options.allowInsecureHttp ?? false);
    this.protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.baseHeaders = safeHeaders(options.headers);
  }

  private async send(method: string, params: Record<string, unknown> | undefined, notification = false): Promise<unknown> {
    const id = notification ? undefined : ++this.requestId;
    const message = {
      jsonrpc: "2.0" as const,
      ...(id !== undefined ? { id } : {}),
      method,
      ...(params !== undefined ? { params } : {})
    };
    const headers = new Headers(this.baseHeaders);
    headers.set("accept", "application/json, text/event-stream");
    headers.set("content-type", "application/json");
    if (this.initialized) headers.set("mcp-protocol-version", this.negotiatedVersion ?? this.protocolVersion);
    if (this.sessionId !== undefined) headers.set("mcp-session-id", this.sessionId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: controller.signal
      });
    } catch (error) {
      throw new DvarConfigurationError(`Unable to reach MCP server ${this.endpoint.toString()}`, [], { cause: error });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new DvarConfigurationError(`MCP server returned HTTP ${response.status} for ${method}`);
    }
    const returnedSession = response.headers.get("mcp-session-id");
    if (returnedSession !== null) this.sessionId = returnedSession;
    const messages = await parseMcpResponseMessages(response);
    if (notification || id === undefined) return undefined;
    const rpc = rpcResponse(messages, id);
    if (rpc.error !== undefined) {
      throw new DvarConfigurationError(`MCP ${method} failed (${rpc.error.code}): ${rpc.error.message}`);
    }
    return rpc.result;
  }

  public async initialize(): Promise<InitializeResult> {
    if (this.initialized && this.initializeResult !== undefined) return this.initializeResult;
    const result = await this.send("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: "dvar", version: "0.2.0-alpha.0" }
    });
    if (result === null || typeof result !== "object") {
      throw new DvarConfigurationError("MCP initialize returned an invalid result");
    }
    this.initializeResult = result as InitializeResult;
    this.negotiatedVersion = this.initializeResult.protocolVersion ?? this.protocolVersion;
    this.initialized = true;
    await this.send("notifications/initialized", undefined, true);
    return this.initializeResult;
  }

  public async listTools(): Promise<DvarMcpToolDefinition[]> {
    await this.initialize();
    const tools: DvarMcpToolDefinition[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.send("tools/list", cursor === undefined ? {} : { cursor });
      if (result === null || typeof result !== "object") {
        throw new DvarConfigurationError("MCP tools/list returned an invalid result");
      }
      const record = result as Record<string, unknown>;
      if (!Array.isArray(record.tools)) {
        throw new DvarConfigurationError("MCP tools/list result does not contain tools[]");
      }
      tools.push(...record.tools.map(toolDefinition));
      cursor = typeof record.nextCursor === "string" && record.nextCursor.length > 0
        ? record.nextCursor
        : undefined;
    } while (cursor !== undefined);
    return tools;
  }

  public async close(): Promise<void> {
    if (this.sessionId === undefined) return;
    const headers = new Headers(this.baseHeaders);
    headers.set("mcp-session-id", this.sessionId);
    headers.set("mcp-protocol-version", this.negotiatedVersion ?? this.protocolVersion);
    try {
      await this.fetchFn(this.endpoint, { method: "DELETE", headers });
    } catch {
      // Session cleanup is best effort and must not hide a completed scan.
    }
    this.sessionId = undefined;
  }

  public get negotiatedProtocolVersion(): string {
    return this.negotiatedVersion ?? this.protocolVersion;
  }

  public get serverInfo(): InitializeResult["serverInfo"] {
    return this.initializeResult?.serverInfo;
  }

  public get advertisedCapabilities(): InitializeResult["capabilities"] {
    return this.initializeResult?.capabilities;
  }
}

export async function scanMcpServer(options: DvarMcpScanOptions): Promise<DvarInventory> {
  const client = new DvarMcpHttpClient(options);
  try {
    const tools = await client.listTools();
    const server = createServerInventory({
      id: options.serverId ?? sanitizeServerId(client.endpoint),
      endpoint: client.endpoint.toString(),
      protocolVersion: client.negotiatedProtocolVersion,
      ...(client.serverInfo !== undefined ? { serverInfo: client.serverInfo } : {}),
      ...(client.advertisedCapabilities !== undefined
        ? { advertisedCapabilities: client.advertisedCapabilities }
        : {}),
      tools
    });
    return createInventory([server]);
  } finally {
    await client.close();
  }
}
