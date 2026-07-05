import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { sha256 } from "../canonical.js";
import { DvarConfigurationError } from "../errors.js";
import { findLockedServer } from "../lockfile.js";
import type { DvarOutputGuardOptions } from "../output-guard/index.js";
import type { DvarRuntime } from "../runtime.js";
import type {
  DvarAction,
  DvarInventory,
  DvarInventoryServer,
  DvarMcpProxyContext,
  DvarPrincipal,
  DvarToolContext
} from "../types.js";
import { parseMcpResponseMessages, validateMcpEndpoint } from "./client.js";

const HOP_BY_HOP = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export interface DvarMcpProxyOptions {
  upstream: string | URL;
  runtime: DvarRuntime;
  serverId?: string;
  upstreamHeaders?: Record<string, string>;
  allowInsecureHttp?: boolean;
  forwardAuthorization?: boolean;
  maxBodyBytes?: number;
  fetch?: typeof globalThis.fetch;
  inventory?: DvarInventory;
  outputGuard?: DvarOutputGuardOptions;
  contextResolver?: (
    request: IncomingMessage
  ) => DvarMcpProxyContext | Promise<DvarMcpProxyContext>;
}

export interface DvarMcpProxyListenOptions {
  host?: string;
  port: number;
}

export interface DvarMcpProxy {
  readonly server: Server;
  listen(options: DvarMcpProxyListenOptions): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

interface RpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function principalType(value: string | undefined): DvarPrincipal["type"] {
  return value === "service" || value === "workload" || value === "agent" ? value : "user";
}

function defaultContext(request: IncomingMessage): DvarMcpProxyContext {
  const tenantId = header(request, "x-dvar-tenant-id");
  const sessionId = header(request, "x-dvar-session-id") ?? header(request, "mcp-session-id");
  return {
    principal: {
      id: header(request, "x-dvar-principal-id") ?? "anonymous",
      type: principalType(header(request, "x-dvar-principal-type"))
    },
    agent: { id: header(request, "x-dvar-agent-id") ?? "mcp-client" },
    environment: header(request, "x-dvar-environment") ?? "development",
    ...(tenantId !== undefined ? { tenant: { id: tenantId } } : {}),
    ...(sessionId !== undefined ? { session: { id: sessionId } } : {})
  };
}

function traceContext(request: IncomingMessage): DvarAction["trace"] | undefined {
  const traceparent = header(request, "traceparent");
  if (traceparent === undefined) return undefined;
  const match = /^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/iu.exec(traceparent.trim());
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
  return { traceId: match[1].toLowerCase(), spanId: match[2].toLowerCase() };
}

async function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > maxBodyBytes) {
      throw new DvarConfigurationError(`MCP request exceeds ${maxBodyBytes} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function upstreamRequestHeaders(
  request: IncomingMessage,
  configured: Record<string, string> | undefined,
  forwardAuthorization: boolean
): Headers {
  const headers = new Headers();
  for (const name of [
    "accept",
    "content-type",
    "mcp-protocol-version",
    "mcp-session-id",
    "last-event-id",
    "traceparent",
    "tracestate"
  ]) {
    const value = header(request, name);
    if (value !== undefined) headers.set(name, value);
  }
  if (forwardAuthorization) {
    const authorization = header(request, "authorization");
    if (authorization !== undefined) headers.set("authorization", authorization);
  }
  for (const [name, value] of Object.entries(configured ?? {})) {
    if (HOP_BY_HOP.has(name.toLowerCase()) || /\r|\n/u.test(name) || /\r|\n/u.test(value)) {
      throw new DvarConfigurationError(`Unsafe upstream header: ${name}`);
    }
    headers.set(name, value);
  }
  if (!headers.has("accept")) headers.set("accept", "application/json, text/event-stream");
  return headers;
}

function copyResponseHeaders(response: Response, target: ServerResponse): void {
  response.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== "set-cookie") {
      target.setHeader(name, value);
    }
  });
}

async function pipeResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  copyResponseHeaders(response, target);
  if (response.body === null) {
    target.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
    stream.on("error", reject);
    target.on("finish", resolve);
    target.on("error", reject);
    stream.pipe(target);
  });
}

function json(target: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  target.statusCode = status;
  target.setHeader("content-type", "application/json");
  target.setHeader("content-length", Buffer.byteLength(encoded));
  target.end(encoded);
}

function rpcError(message: RpcMessage, decision: Awaited<ReturnType<DvarRuntime["evaluate"]>>): unknown | undefined {
  if (message.id === undefined) return undefined;
  return {
    jsonrpc: "2.0",
    id: message.id,
    error: {
      code: decision.effect === "require_approval" ? -32002 : -32001,
      message: decision.effect === "require_approval"
        ? "Dvar approval is required for this action"
        : "Dvar denied this action",
      data: {
        dvar: {
          decisionId: decision.id,
          effect: decision.effect,
          ruleId: decision.ruleId,
          reasonCode: decision.reasonCode,
          risk: decision.risk.level
        }
      }
    }
  };
}

function isToolCall(message: RpcMessage): boolean {
  return message.method === "tools/call";
}

function objectMessage(value: unknown): RpcMessage | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RpcMessage
    : undefined;
}

function serverIdFrom(upstream: URL): string {
  const host = upstream.hostname.replace(/[^a-zA-Z0-9._-]/gu, "-") || "mcp-server";
  return `${host}-${sha256(upstream.toString()).slice(0, 8)}`;
}

function inventoryServer(
  inventory: DvarInventory | undefined,
  serverId: string,
  endpoint: string
): DvarInventoryServer | undefined {
  return inventory?.servers.find((server) => server.id === serverId || server.endpoint === endpoint);
}

async function actionFor(
  runtime: DvarRuntime,
  upstream: URL,
  serverId: string,
  message: RpcMessage,
  context: DvarMcpProxyContext,
  request: IncomingMessage,
  inventory?: DvarInventory
): Promise<DvarAction> {
  const params = message.params !== null && typeof message.params === "object"
    ? message.params as Record<string, unknown>
    : {};
  const toolName = typeof params.name === "string" ? params.name : "";
  const arguments_ = params.arguments ?? {};
  const lockedTool = runtime.lockedTool(serverId, toolName, upstream.toString());
  const lockedServer = findLockedServer(runtime.lockfile, serverId, upstream.toString());
  const observedServer = inventoryServer(inventory, serverId, upstream.toString());
  const observedTool = observedServer?.tools.find((tool) => tool.name === toolName);
  const effectiveTool = observedTool ?? lockedTool;
  const trace = traceContext(request);
  return {
    id: randomUUID(),
    principal: context.principal,
    agent: context.agent,
    ...(context.tenant !== undefined ? { tenant: context.tenant } : {}),
    ...(context.session !== undefined ? { session: context.session } : {}),
    environment: context.environment,
    server: {
      id: serverId,
      transport: "streamable-http",
      endpoint: upstream.toString(),
      ...(observedServer !== undefined || lockedServer !== undefined
        ? { integrity: { manifestSha256: (observedServer ?? lockedServer)!.integrity.manifestSha256 } }
        : {})
    },
    tool: {
      name: toolName,
      capabilities: effectiveTool?.capabilities ?? [],
      ...(effectiveTool !== undefined
        ? {
            schemaHash: effectiveTool.inputSchemaSha256,
            ...(effectiveTool.outputSchemaSha256 !== undefined
              ? { outputSchemaHash: effectiveTool.outputSchemaSha256 }
              : {}),
            descriptionHash: effectiveTool.descriptionSha256,
            annotationsHash: effectiveTool.annotationsSha256,
            ...(effectiveTool.annotations !== undefined ? { annotations: effectiveTool.annotations } : {})
          }
        : {})
    },
    arguments: arguments_,
    destination: { type: "url", value: upstream.toString() },
    ...(trace !== undefined ? { trace } : {}),
    metadata: { protocol: "mcp", jsonRpcMethod: "tools/call" }
  };
}

interface EnforcementOutcome {
  blocked: boolean;
  response?: unknown;
}

async function enforceMessage(
  runtime: DvarRuntime,
  upstream: URL,
  serverId: string,
  message: RpcMessage,
  context: DvarMcpProxyContext,
  request: IncomingMessage,
  inventory?: DvarInventory
): Promise<EnforcementOutcome> {
  if (!isToolCall(message)) return { blocked: false };
  const action = await actionFor(runtime, upstream, serverId, message, context, request, inventory);
  const decision = await runtime.evaluate(action);
  if (decision.effect === "allow") return { blocked: false };
  const response = rpcError(message, decision);
  return { blocked: true, ...(response !== undefined ? { response } : {}) };
}

export function createMcpHttpProxy(options: DvarMcpProxyOptions): DvarMcpProxy {
  const upstream = validateMcpEndpoint(options.upstream, options.allowInsecureHttp ?? false);
  const fetchFn = options.fetch ?? globalThis.fetch;
  const serverId = options.serverId ?? serverIdFrom(upstream);
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" || request.method === "DELETE") {
        const upstreamResponse = await fetchFn(upstream, {
          method: request.method,
          headers: upstreamRequestHeaders(request, options.upstreamHeaders, options.forwardAuthorization ?? false)
        });
        await pipeResponse(upstreamResponse, response);
        return;
      }
      if (request.method !== "POST") {
        response.setHeader("allow", "GET, POST, DELETE");
        json(response, 405, { error: "Method not allowed" });
        return;
      }

      const body = await readBody(request, maxBodyBytes);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        json(response, 400, { error: "Invalid JSON" });
        return;
      }
      const context = options.contextResolver === undefined
        ? defaultContext(request)
        : await options.contextResolver(request);
      const headers = upstreamRequestHeaders(request, options.upstreamHeaders, options.forwardAuthorization ?? false);
      headers.set("content-type", "application/json");

      if (!Array.isArray(parsed)) {
        const message = objectMessage(parsed);
        if (message === undefined) {
          json(response, 400, { error: "Invalid JSON-RPC message" });
          return;
        }
        const enforcement = await enforceMessage(options.runtime, upstream, serverId, message, context, request, options.inventory);
        if (enforcement.blocked) {
          if (enforcement.response === undefined) {
            response.statusCode = 202;
            response.end();
          } else {
            json(response, 200, enforcement.response);
          }
          return;
        }
        if (isToolCall(message) && message.id === undefined) {
          // Allowed notification: forward it and return the upstream acknowledgement.
        }
        const upstreamResponse = await fetchFn(upstream, { method: "POST", headers, body });
        await pipeResponse(upstreamResponse, response);
        return;
      }

      const blockedResponses: unknown[] = [];
      const forwarded: unknown[] = [];
      for (const value of parsed) {
        const message = objectMessage(value);
        if (message === undefined) {
          blockedResponses.push({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
          continue;
        }
        const enforcement = await enforceMessage(options.runtime, upstream, serverId, message, context, request, options.inventory);
        if (enforcement.blocked) {
          if (enforcement.response !== undefined) blockedResponses.push(enforcement.response);
        } else {
          forwarded.push(value);
        }
      }

      let upstreamMessages: unknown[] = [];
      if (forwarded.length > 0) {
        const upstreamResponse = await fetchFn(upstream, {
          method: "POST",
          headers,
          body: JSON.stringify(forwarded)
        });
        if (!upstreamResponse.ok) {
          await pipeResponse(upstreamResponse, response);
          return;
        }
        upstreamMessages = await parseMcpResponseMessages(upstreamResponse);
      }
      const combined = [...upstreamMessages, ...blockedResponses];
      if (combined.length === 0) {
        response.statusCode = 202;
        response.end();
      } else {
        json(response, 200, combined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(response, error instanceof DvarConfigurationError ? 400 : 502, {
        error: "Dvar MCP proxy failure",
        message
      });
    }
  });

  return {
    server,
    listen: ({ host = "127.0.0.1", port }) => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        const address = server.address();
        if (address === null || typeof address === "string") {
          reject(new Error("Dvar proxy did not receive a TCP address"));
          return;
        }
        resolve({ host: address.address, port: address.port });
      });
    }),
    close: () => new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => error === undefined ? resolve() : reject(error));
    })
  };
}

export function proxyContextToToolContext(context: DvarMcpProxyContext): DvarToolContext {
  return {
    principal: context.principal,
    agent: context.agent,
    environment: context.environment,
    ...(context.tenant !== undefined ? { tenant: context.tenant } : {}),
    ...(context.session !== undefined ? { session: context.session } : {})
  };
}
