# Network security foundation — v1 slice 01

This is the first implementation slice for **F01 (SSRF protection)** and
**F02 (network egress firewall)**. Both features remain in progress until all
supported consumers and deployment boundaries are integrated and qualified.
There is no npm publication in this slice.

## Use the protected HTTP boundary

```ts
import { createGuardedFetch } from '@rokadhq/dvar/network';
import { scanMcpServer } from '@rokadhq/dvar/mcp';

const guardedFetch = createGuardedFetch({
  policy: {
    allowedHosts: ['mcp.example.com'],
    allowedPorts: [443],
    allowedMethods: ['GET', 'HEAD', 'POST', 'DELETE'],
    maxRedirects: 0,
    timeoutMs: 15_000,
    maxRequestBytes: 1_048_576,
    maxResponseBytes: 1_048_576,
  },
});

const inventory = await scanMcpServer({
  endpoint: 'https://mcp.example.com/mcp',
  serverId: 'reviewed-mcp-server',
  fetch: guardedFetch,
});
```

For a proxy, supply `fetch: guardedFetch` to `createMcpHttpProxy` as well.
The network policy is a **separate constructor configuration** in this slice;
adding a `network` property to `dvar.yaml` is not supported yet. Do not assume
that importing this module installs global hooks. Every protected execution
path must explicitly use the guarded transport. Existing paths using ordinary
`fetch`, unwrapped tools or child processes remain outside this boundary.

The policy and private-address exceptions must be application-owned configuration,
not values selected by a model or copied from an untrusted request.

## Enforcement sequence

1. Reject ambiguous/oversized URLs, embedded credentials and unsupported schemes.
2. Normalize the host (case, IDNA, IPv6 brackets and one trailing dot); apply
   deny-before-allow host rules and explicit method/port restrictions before DNS.
3. Resolve all addresses and reject the entire answer set if any address is
   invalid or disallowed. Literal IPs undergo the same classification.
4. Connect directly to the selected, validated IP address, without another DNS
   lookup, a caller-supplied dispatcher, socket pooling or unchecked fallback.
5. Retain the original URL authority for HTTP `Host`, TLS SNI and certificate
   hostname verification. TLS verification is never disabled by this API.
6. Bound upload and download bytes and the entire request deadline, including
   body consumption, DNS, connections, redirects and response-body completion.
7. With explicit redirect allowance, permit only same-origin GET/HEAD redirects.
   Re-resolve and revalidate every hop. Cross-origin and side-effecting redirects
   are rejected rather than replaying credentials or POST bodies.

`redirect: 'manual'` returns a redirect response without following it. Default
behavior with `maxRedirects: 0` rejects redirects. `redirect: 'error'` always
rejects a redirect. The policy cannot be relaxed by request-level fetch options.

## Defaults and exceptions

| Setting | Default |
|---|---|
| `allowedHosts` | Empty: deny every destination |
| `allowedPorts` | `[443]` |
| `allowedMethods` | `['GET', 'HEAD']` |
| `allowHttp` | `false` |
| `allowedPrivateAddresses` | Empty |
| `maxRedirects` | `0` |
| `timeoutMs` | `15000` |
| `maxRequestBytes`, `maxResponseBytes` | `1048576` each |

Host patterns are exact names or `*.example.com`; the wildcard matches
subdomains, **not** the apex. Substring/suffix confusion such as
`example.com.evil.test` does not match `example.com`.

The IP classifier conservatively rejects special-purpose ranges, including
metadata/link-local, CGNAT, multicast, reserved, documentation, benchmark and
IPv6 transition ranges. IPv4-mapped IPv6 is classified as its underlying IPv4
address. IPv6 global unicast is intentionally restricted with additional
special-purpose exclusions; this is not a claim that any accepted address is
actually reachable or safe for a specific application.

An explicit `allowedPrivateAddresses` entry can allow one loopback, RFC1918 or
IPv6 ULA address. It cannot allow a metadata/link-local/special-purpose address.
The hostname, method, port and scheme must still pass policy. No CIDR-wide
private-network override is provided in slice 01.

## Bounded transport, not a general fetch replacement

The implementation uses Node HTTP/HTTPS and buffers a bounded response before
returning a standard `Response`. It supports ordinary HTTP(S), Request/URL/string
inputs, request bodies, signals and manual redirects. It deliberately rejects
compressed upstream responses, HTTP upgrades and requested subresource-integrity
options instead of silently bypassing controls or pretending to implement them.
It does not add a cookie jar, ambient proxy, custom agent or HTTP/2 coalescing.

This is **not a live SSE, WebSocket or streaming DLP implementation**. A finite
SSE body can be buffered within limits; an open-ended stream times out. Protocol-
aware streaming and cross-chunk DLP are tracked separately in F27 and F34.
Content filtering still requires an output guard; address validation alone is
not prompt-injection detection, data classification or exfiltration prevention.

Errors expose stable `network.*` codes, not destination paths, query values,
request headers, payloads or the original resolver/transport error. Integrations
can translate those errors into their own decision/audit boundary without logging
raw URLs or credentials.

## Qualification

The shared regression cases run against source in Vitest and against the built
ESM subpath through Node's test runner. Local HTTP/TLS tests cover real socket
connections, original-host TLS verification, untrusted certificates, DNS
rebinding on redirect, credential non-forwarding, byte limits and abort races.
TLS fixtures are public test credentials, never production trust material.

Before F01/F02 can be marked verified, qualify full package ESM/CommonJS builds,
all supported Node versions, actual MCP/webhook consumers, proxy environments,
real resolver behavior, platform-specific networking and independent adversarial
review. Network ACLs/container egress controls remain necessary for processes
or traffic that do not pass through Dvar.

## Primary references

- OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- Node HTTPS/TLS API: https://nodejs.org/api/https.html
- IANA IPv4 special-purpose registry: https://www.iana.org/assignments/iana-ipv4-special-registry/
- IANA IPv6 special-purpose registry: https://www.iana.org/assignments/iana-ipv6-special-registry/
