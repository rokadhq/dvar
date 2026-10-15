import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { canonicalIp, classifyIpAddress } from "./address.js";
import { DvarNetworkError } from "./errors.js";
import type { DvarNetworkOptions, DvarNetworkTarget, DvarResolvedAddress } from "./types.js";

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.goog", "instance-data.ec2.internal"]);

function invalid(): never { throw new DvarNetworkError("network.configuration_invalid"); }

function integer(value: number | undefined, fallback: number, min: number, max: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) invalid();
  return result;
}

export function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/gu, "").replace(/\.$/u, "").toLowerCase();
}

export function parseNetworkUrl(input: string | URL): URL {
  const source = String(input);
  // Reject parser-ambiguous spellings instead of silently repairing them.
  if (source.length > 8192 || source.trim() !== source || /[\u0000-\u0020\u007f\\]/u.test(source)) {
    throw new DvarNetworkError("network.url_invalid");
  }
  let url: URL;
  try { url = new URL(source); } catch { throw new DvarNetworkError("network.url_invalid"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DvarNetworkError("network.scheme_denied");
  }
  if (url.username || url.password) throw new DvarNetworkError("network.credentials_denied");
  const hostname = normalizedHostname(url);
  if (!hostname || hostname.includes("%") || hostname.endsWith(".")) {
    throw new DvarNetworkError("network.url_invalid");
  }
  url.hostname = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  url.hash = "";
  return url;
}

function hostPattern(source: string): string {
  if (typeof source !== "string" || source.length > 255) invalid();
  const wildcard = source.startsWith("*.");
  const host = wildcard ? source.slice(2) : source;
  // Host patterns are not URLs. No paths, userinfo, ports or encoded syntax.
  if (!host || /[\s/@?#%\\]/u.test(host) || host.includes("*")) invalid();
  const ipv6 = isIP(host) === 6;
  let url: URL;
  try { url = parseNetworkUrl(`https://${ipv6 ? `[${host}]` : host}`); } catch { invalid(); }
  const normalized = normalizedHostname(url!);
  if (url!.port || (!ipv6 && host.includes(":"))) invalid();
  if (wildcard && (isIP(normalized) !== 0 || !normalized.includes("."))) invalid();
  return wildcard ? `*.${normalized}` : normalized;
}

function matches(hostname: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => pattern.startsWith("*.")
    ? hostname.endsWith(pattern.slice(1)) && hostname !== pattern.slice(2)
    : hostname === pattern);
}

/** Internal immutable policy compiler shared by preview and the actual transport. */
export function compileNetworkPolicy(options: DvarNetworkOptions = {}) {
  const policy = options.policy ?? {};
  if (policy.allowHttp !== undefined && typeof policy.allowHttp !== "boolean") invalid();
  const list = <T>(value: readonly T[] | undefined): readonly T[] => {
    if (value !== undefined && (!Array.isArray(value) || value.length > 256)) invalid();
    return value ?? [];
  };
  const allowedHosts = list(policy.allowedHosts).map(hostPattern);
  const deniedHosts = list(policy.deniedHosts).map(hostPattern);
  const allowedPorts = list(policy.allowedPorts ?? [443]).map(port => integer(port, 443, 1, 65535));
  const allowedMethods = list(policy.allowedMethods ?? ["GET", "HEAD"]).map(method => {
    if (typeof method !== "string" || !METHODS.has(method)) invalid();
    return method;
  });
  const privateAddresses = new Set(list(policy.allowedPrivateAddresses).map(address => {
    if (typeof address !== "string") invalid();
    const normalized = canonicalIp(address);
    const kind = classifyIpAddress(address);
    if (normalized === undefined || (kind !== "private" && kind !== "loopback")) invalid();
    return normalized;
  }));
  const allowHttp = policy.allowHttp === true;
  const resolve = options.resolve ?? (async (hostname: string): Promise<DvarResolvedAddress[]> => {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map(record => ({ address: record.address, family: record.family as 4 | 6 }));
  });
  if (typeof resolve !== "function") invalid();
  const settings = Object.freeze({
    maxRedirects: integer(policy.maxRedirects, 0, 0, 10),
    timeoutMs: integer(policy.timeoutMs, 15_000, 1, 300_000),
    maxRequestBytes: integer(policy.maxRequestBytes, 1_048_576, 0, 67_108_864),
    maxResponseBytes: integer(policy.maxResponseBytes, 1_048_576, 0, 67_108_864)
  });

  function validateUrl(input: string | URL, method: string): URL {
    const url = parseNetworkUrl(input);
    const hostname = normalizedHostname(url);
    if (url.protocol === "http:" && !allowHttp) throw new DvarNetworkError("network.scheme_denied");
    if (METADATA_HOSTS.has(hostname)) throw new DvarNetworkError("network.metadata_denied");
    if (matches(hostname, deniedHosts)) throw new DvarNetworkError("network.host_denied");
    if (!matches(hostname, allowedHosts)) throw new DvarNetworkError("network.host_not_allowed");
    if (!allowedPorts.includes(Number(url.port || (url.protocol === "https:" ? 443 : 80)))) {
      throw new DvarNetworkError("network.port_denied");
    }
    if (!allowedMethods.includes(method)) throw new DvarNetworkError("network.method_denied");
    return url;
  }

  async function authorize(input: string | URL, method = "GET"): Promise<DvarNetworkTarget> {
    const url = validateUrl(input, method);
    const hostname = normalizedHostname(url);
    const literalFamily = isIP(hostname);
    let records: readonly DvarResolvedAddress[];
    try {
      records = literalFamily === 0 ? await resolve(hostname)
        : [{ address: hostname, family: literalFamily as 4 | 6 }];
    } catch { throw new DvarNetworkError("network.dns_failed"); }
    if (!Array.isArray(records) || records.length === 0 || records.length > 64) {
      throw new DvarNetworkError("network.dns_invalid");
    }
    // Reject the entire answer set if ANY fallback address is unsafe.
    for (const record of records) {
      if (!record || typeof record.address !== "string" || ![4, 6].includes(record.family)
        || isIP(record.address) !== record.family || record.address.includes("%")) {
        throw new DvarNetworkError("network.dns_invalid");
      }
      const kind = classifyIpAddress(record.address);
      if (kind === "blocked" || (kind !== "public" && !privateAddresses.has(canonicalIp(record.address)!))) {
        throw new DvarNetworkError("network.address_denied");
      }
    }
    const selected = records[0]!;
    return Object.freeze({
      url: url.toString(), hostname, method,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      address: selected.address, family: selected.family
    });
  }
  return { settings, validateUrl, authorize };
}
