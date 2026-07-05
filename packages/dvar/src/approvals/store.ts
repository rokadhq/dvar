import type { DvarApprovalUseResult, DvarApprovalUseStore } from "../types.js";

interface UseRecord {
  uses: number;
  expiresAtMs: number;
}

export class InMemoryApprovalUseStore implements DvarApprovalUseStore {
  private readonly records = new Map<string, UseRecord>();

  public consume(
    nonce: string,
    maxUses: number,
    expiresAt: string
  ): DvarApprovalUseResult {
    const now = Date.now();
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      return { accepted: false, uses: 0, reason: "expired" };
    }

    const existing = this.records.get(nonce);
    const uses = existing?.uses ?? 0;
    if (uses >= maxUses) {
      return { accepted: false, uses, reason: "replayed" };
    }

    const next = uses + 1;
    this.records.set(nonce, { uses: next, expiresAtMs });
    if (this.records.size > 10_000) this.prune(now);
    return { accepted: true, uses: next };
  }

  public prune(now = Date.now()): number {
    let removed = 0;
    for (const [nonce, record] of this.records) {
      if (record.expiresAtMs <= now) {
        this.records.delete(nonce);
        removed += 1;
      }
    }
    return removed;
  }
}
