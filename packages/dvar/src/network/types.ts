/** This policy applies only to requests routed through createGuardedFetch(). */
export interface DvarNetworkPolicy {
  /** Exact hosts or '*.example.com'. Empty/omitted means deny every destination. */
  allowedHosts?: readonly string[];
  deniedHosts?: readonly string[];
  /** HTTPS/443 and GET/HEAD are the defaults. No HTTP unless explicitly enabled. */
  allowedPorts?: readonly number[];
  allowedMethods?: readonly string[];
  allowHttp?: boolean;
  /** Exact loopback/RFC1918/ULA addresses only; never metadata/link-local ranges. */
  allowedPrivateAddresses?: readonly string[];
  /** Default zero. Only GET/HEAD, same-origin redirects may be followed. */
  maxRedirects?: number;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

export interface DvarResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface DvarNetworkOptions {
  policy?: DvarNetworkPolicy;
  /** Trusted application/test injection. Every returned address is still validated. */
  resolve?: (hostname: string) => Promise<readonly DvarResolvedAddress[]>;
}

export interface DvarNetworkTarget {
  readonly url: string;
  readonly hostname: string;
  readonly port: number;
  readonly method: string;
  readonly address: string;
  readonly family: 4 | 6;
}

export type DvarAddressKind = "public" | "private" | "loopback" | "blocked";
