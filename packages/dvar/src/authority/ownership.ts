import { fail } from "./errors.js";
import { number, record, snapshot, text } from "./validation.js";
import type { DvarOwnershipRecord, DvarResourceReference, DvarVerifiedIdentity, DvarVerifiedResource } from "./types.js";

export function references(raw: unknown): readonly DvarResourceReference[] {
  const list: unknown = snapshot(raw, "ownership.references_invalid", 16_384);
  if (!Array.isArray(list) || list.length < 1 || list.length > 16) fail("ownership.references_invalid");
  const seen = new Set<string>();
  const result = list.map(item => {
    const value = record(item, ["type", "id", "operation"], "ownership.references_invalid");
    const type = text(value.type, "ownership.references_invalid");
    const id = text(value.id, "ownership.references_invalid");
    if (!["read", "write", "delete"].includes(String(value.operation))) fail("ownership.references_invalid");
    const key = JSON.stringify([type, id]);
    if (seen.has(key)) fail("ownership.references_invalid");
    seen.add(key);
    return { type, id, operation: value.operation as DvarResourceReference["operation"] };
  });
  // Stable ordering binds equivalent selections identically in approval action hashes.
  result.sort((a, b) => JSON.stringify([a.type, a.id]).localeCompare(JSON.stringify([b.type, b.id])));
  return snapshot(result, "ownership.references_invalid", 16_384);
}

export function checkOwnershipTime(value: DvarOwnershipRecord, now: number, maxAgeMs: number): void {
  if (value.observedAtMs > now || value.validUntilMs <= now || now - value.observedAtMs > maxAgeMs) fail("ownership.stale");
}

export function validateOwnership(raw: unknown, reference: DvarResourceReference, identity: DvarVerifiedIdentity,
  mode: "owner" | "tenant", now: number, maxAgeMs: number): DvarOwnershipRecord {
  // Keep missing, other-tenant and other-owner replies indistinguishable in outward errors.
  if (raw === null) fail("ownership.denied");
  const value = record(snapshot(raw, "ownership.invalid", 4096), [
    "type", "id", "tenantId", "ownerId", "version", "observedAtMs", "validUntilMs", "classification"
  ], "ownership.invalid");
  const result: DvarOwnershipRecord = {
    type: text(value.type, "ownership.invalid"), id: text(value.id, "ownership.invalid"),
    tenantId: text(value.tenantId, "ownership.invalid"), ownerId: text(value.ownerId, "ownership.invalid"),
    version: text(value.version, "ownership.invalid"),
    observedAtMs: number(value.observedAtMs, "ownership.invalid", 0),
    validUntilMs: number(value.validUntilMs, "ownership.invalid", 1),
    ...(value.classification === undefined ? {} : { classification: text(value.classification, "ownership.invalid") })
  };
  if (result.type !== reference.type || result.id !== reference.id || result.tenantId !== identity.tenantId ||
    (mode === "owner" && result.ownerId !== identity.principal.id)) fail("ownership.denied");
  if (result.validUntilMs <= result.observedAtMs) fail("ownership.invalid");
  checkOwnershipTime(result, now, maxAgeMs);
  return snapshot(result, "ownership.invalid", 4096);
}

export function projectResource(value: DvarOwnershipRecord, reference: DvarResourceReference): DvarVerifiedResource {
  return {
    type: value.type, id: value.id, tenantId: value.tenantId, ownerId: value.ownerId,
    version: value.version, operation: reference.operation,
    ...(value.classification === undefined ? {} : { classification: value.classification })
  };
}
