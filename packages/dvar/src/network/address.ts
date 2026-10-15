import { isIP } from "node:net";
import type { DvarAddressKind } from "./types.js";

function ipv4Number(address: string): number {
  return address.split(".").reduce((result, part) => result * 256 + Number(part), 0);
}

function inV4(address: number, base: string, bits: number): boolean {
  const size = 2 ** (32 - bits);
  return Math.floor(address / size) === Math.floor(ipv4Number(base) / size);
}

function v4Kind(address: string): DvarAddressKind {
  const value = ipv4Number(address);
  if (inV4(value, "127.0.0.0", 8)) return "loopback";
  if (inV4(value, "10.0.0.0", 8) || inV4(value, "172.16.0.0", 12)
    || inV4(value, "192.168.0.0", 16)) return "private";
  // Conservative deny set, including documentation, transition, reserved and
  // cloud platform addresses. This is not an assertion of global routability.
  const ranges: ReadonlyArray<readonly [string, number]> = [
    ["0.0.0.0", 8], ["100.64.0.0", 10], ["169.254.0.0", 16],
    ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
    ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
    ["224.0.0.0", 4], ["240.0.0.0", 4], ["168.63.129.16", 32]
  ];
  return ranges.some(([base, bits]) => inV4(value, base, bits)) ? "blocked" : "public";
}

function v6Number(address: string): bigint {
  let expanded = address;
  if (expanded.includes(".")) {
    const separator = expanded.lastIndexOf(":");
    const v4 = ipv4Number(expanded.slice(separator + 1));
    expanded = `${expanded.slice(0, separator)}:${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const sides = expanded.split("::");
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const words = sides.length === 2
    ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
    : left;
  return words.reduce((result, word) => (result << 16n) | BigInt(`0x${word}`), 0n);
}

function inV6(value: bigint, base: string, bits: number): boolean {
  const shift = BigInt(128 - bits);
  return (value >> shift) === (v6Number(base) >> shift);
}

/** Normalize for exact-address exception matching, including mapped IPv4. */
export function canonicalIp(address: string): string | undefined {
  if (address.includes("%")) return undefined;
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return undefined;
  const value = v6Number(address);
  if ((value >> 32n) === 0xffffn) {
    const v4 = Number(value & 0xffffffffn);
    return [24, 16, 8, 0].map(shift => String((v4 >>> shift) & 255)).join(".");
  }
  return value.toString(16).padStart(32, "0").match(/.{4}/gu)!.join(":");
}

/** Invalid, scoped, special-purpose and transition addresses fail closed. */
export function classifyIpAddress(address: string): DvarAddressKind {
  if (address.includes("%")) return "blocked";
  const family = isIP(address);
  if (family === 4) return v4Kind(address);
  if (family !== 6) return "blocked";
  const value = v6Number(address);
  if ((value >> 32n) === 0xffffn) return v4Kind(canonicalIp(address)!);
  if (value === 1n) return "loopback";
  if (inV6(value, "fc00::", 7)) return "private";
  if (!inV6(value, "2000::", 3)) return "blocked";
  const ranges: ReadonlyArray<readonly [string, number]> = [
    ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]
  ];
  return ranges.some(([base, bits]) => inV6(value, base, bits)) ? "blocked" : "public";
}
