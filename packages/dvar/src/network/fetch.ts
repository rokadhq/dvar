import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import { DvarNetworkError } from "./errors.js";
import { compileNetworkPolicy, parseNetworkUrl } from "./policy.js";
import type { DvarNetworkOptions, DvarNetworkTarget } from "./types.js";

const FORBIDDEN_HEADERS = new Set([
  "host", "connection", "content-length", "transfer-encoding", "upgrade",
  "proxy-authorization", "proxy-connection", "keep-alive", "te", "trailer", "expect"
]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function abortError(signal: AbortSignal): DvarNetworkError {
  return signal.reason instanceof DvarNetworkError
    ? signal.reason : new DvarNetworkError("network.aborted");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    const onAbort = (): void => { cleanup(); reject(abortError(signal)); };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    operation.then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); }
    );
  });
}

async function requestBody(request: Request, limit: number, signal: AbortSignal): Promise<Buffer | undefined> {
  if (request.body === null) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new DvarNetworkError("network.body_invalid");
      bytes += value.byteLength;
      if (bytes > limit) throw new DvarNetworkError("network.request_too_large");
      // Do not retain mutable user-supplied stream chunks across awaits.
      chunks.push(Uint8Array.from(value));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

interface WireResponse {
  body: Buffer;
  status: number;
  statusText: string;
  headers: Headers;
}

function responseHeaders(response: IncomingMessage): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) result.append(name, item);
  }
  return result;
}

/** Connect to the validated IP directly. No DNS lookup, proxy, pooled socket or fallback. */
function connect(
  target: DvarNetworkTarget, headers: Headers, body: Buffer | undefined,
  limit: number, signal: AbortSignal
): Promise<WireResponse> {
  throwIfAborted(signal);
  const url = new URL(target.url);
  const requestHeaders = Object.fromEntries(headers.entries());
  requestHeaders.host = url.host;
  requestHeaders["accept-encoding"] = "identity";
  const configuration: RequestOptions = {
    protocol: url.protocol,
    hostname: target.address,
    family: target.family,
    port: target.port,
    path: `${url.pathname}${url.search}`,
    method: target.method,
    headers: requestHeaders,
    agent: false,
    signal,
    maxHeaderSize: 16_384,
    insecureHTTPParser: false
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: DvarNetworkError): void => {
      if (!settled) { settled = true; reject(error); }
    };
    const onResponse = (response: IncomingMessage): void => {
      const status = response.statusCode ?? 0;
      const encoding = response.headers["content-encoding"];
      const rejectResponse = (code: string): void => {
        fail(new DvarNetworkError(code));
        response.destroy();
      };
      if (status < 200 || status > 599) { rejectResponse("network.response_invalid"); return; }
      if (encoding !== undefined && encoding.toLowerCase() !== "identity") {
        rejectResponse("network.encoding_unsupported"); return;
      }
      const advertised = response.headers["content-length"];
      if (advertised !== undefined && Number(advertised) > limit) {
        rejectResponse("network.response_too_large"); return;
      }
      let total = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > limit) { rejectResponse("network.response_too_large"); return; }
        chunks.push(chunk);
      });
      response.once("aborted", () => fail(signal.aborted ? abortError(signal) : new DvarNetworkError("network.response_aborted")));
      response.once("error", () => fail(signal.aborted ? abortError(signal) : new DvarNetworkError("network.transport_error")));
      response.once("end", () => {
        if (settled) return;
        if (signal.aborted) { fail(abortError(signal)); return; }
        try {
          const result = { body: Buffer.concat(chunks), status, statusText: response.statusMessage ?? "", headers: responseHeaders(response) };
          settled = true;
          resolve(result);
        } catch { fail(new DvarNetworkError("network.response_invalid")); }
      });
    };
    const request = url.protocol === "https:"
      ? httpsRequest({
          ...configuration,
          // Retain the ORIGINAL DNS identity for SNI and certificate verification.
          ...(isIP(target.hostname) === 0 ? { servername: target.hostname } : {}),
          rejectUnauthorized: true,
          checkServerIdentity: (_hostname, certificate) => checkServerIdentity(target.hostname, certificate)
        }, onResponse)
      : httpRequest(configuration, onResponse);
    request.once("error", () => fail(signal.aborted ? abortError(signal) : new DvarNetworkError("network.transport_error")));
    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      fail(new DvarNetworkError("network.upgrade_denied"));
    });
    request.end(body);
  });
}

/**
 * Bounded Node HTTP(S) fetch for approved destinations. The result is buffered
 * before disclosure; this is deliberately NOT a live SSE/WebSocket transport.
 * Pass to Dvar's existing MCP/proxy/webhook `fetch` option to protect that path.
 */
export function createGuardedFetch(options: DvarNetworkOptions = {}): typeof globalThis.fetch {
  const policy = compileNetworkPolicy(options);
  return async (input, init) => {
    let request: Request;
    try {
      const url = parseNetworkUrl(input instanceof Request ? input.url : String(input));
      request = new Request(url, input instanceof Request ? new Request(input, init) : init);
    } catch (error) {
      if (error instanceof DvarNetworkError) throw error;
      throw new DvarNetworkError("network.request_invalid");
    }
    if (request.integrity !== "") throw new DvarNetworkError("network.integrity_unsupported");
    for (const name of request.headers.keys()) {
      if (FORBIDDEN_HEADERS.has(name)) throw new DvarNetworkError("network.header_denied");
    }
    const acceptEncoding = request.headers.get("accept-encoding");
    if (acceptEncoding !== null && acceptEncoding.toLowerCase() !== "identity") {
      throw new DvarNetworkError("network.encoding_unsupported");
    }
    policy.validateUrl(request.url, request.method);
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(new DvarNetworkError("network.aborted"));
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) onAbort();
    const timeout = setTimeout(() => controller.abort(new DvarNetworkError("network.timeout")), policy.settings.timeoutMs);
    try {
      throwIfAborted(controller.signal);
      const body = await requestBody(request, policy.settings.maxRequestBytes, controller.signal);
      let destination = request.url;
      for (let redirects = 0; ; redirects += 1) {
        throwIfAborted(controller.signal);
        const target = await abortable(policy.authorize(destination, request.method), controller.signal);
        throwIfAborted(controller.signal);
        const result = await connect(target, request.headers, body, policy.settings.maxResponseBytes, controller.signal);
        const location = result.headers.get("location");
        if (REDIRECTS.has(result.status) && location !== null && request.redirect !== "manual") {
          if (request.redirect === "error" || redirects >= policy.settings.maxRedirects) {
            throw new DvarNetworkError("network.redirect_denied");
          }
          // Never replay a side-effecting request through a redirect.
          if (request.method !== "GET" && request.method !== "HEAD") {
            throw new DvarNetworkError("network.redirect_method_denied");
          }
          let next: URL;
          try {
            if (/[\u0000-\u0020\u007f\\]/u.test(location)) throw new Error();
            next = parseNetworkUrl(new URL(location, target.url));
          } catch { throw new DvarNetworkError("network.redirect_invalid"); }
          if (next.origin !== new URL(target.url).origin) {
            // Do not risk forwarding Authorization, cookies, or custom API-key headers.
            throw new DvarNetworkError("network.redirect_origin_denied");
          }
          destination = next.toString();
          continue; // Re-resolve AND revalidate even for same-host redirects.
        }
        const noBody = request.method === "HEAD" || [204, 205, 304].includes(result.status);
        const response = new Response(noBody ? null : new Uint8Array(result.body), {
          status: result.status, statusText: result.statusText, headers: result.headers
        });
        Object.defineProperties(response, {
          url: { value: target.url }, redirected: { value: redirects > 0 }
        });
        return response;
      }
    } catch (error) {
      if (error instanceof DvarNetworkError) throw error;
      throw new DvarNetworkError("network.transport_error");
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", onAbort);
    }
  };
}
