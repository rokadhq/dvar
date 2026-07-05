import { describe, expect, it, vi } from "vitest";
import {
  DvarApprovalRejectedError,
  InMemoryApprovalUseStore,
  createDvar,
  createHmacApprovalSigner
} from "../src/index.js";
import type {
  DvarAction,
  DvarApprovalProvider,
  DvarPolicy
} from "../src/types.js";

const secret = "0123456789abcdef0123456789abcdef";

function policy(
  scope: "once" | "session" | "task" = "once",
  maxUses = 1
): DvarPolicy {
  return {
    schemaVersion: "1",
    version: "0.3-test",
    mode: "enforce",
    defaultEffect: "deny",
    rules: [{
      id: "approve-refund",
      effect: "require_approval",
      when: { "tool.name": "billing.refund" },
      approval: {
        provider: "test",
        scope,
        maxUses,
        expiresInSeconds: 300,
        ...(scope === "once"
          ? {}
          : {
              bind: [
                "principal.id",
                "agent.id",
                "environment",
                "server.id",
                "tool.name",
                scope === "session" ? "session.id" : "task.id"
              ]
            })
      }
    }]
  };
}

function action(overrides: Partial<DvarAction> = {}): DvarAction {
  return {
    id: "action-1",
    principal: { id: "user-1", type: "user" },
    agent: { id: "finance-agent" },
    tenant: { id: "tenant-a" },
    session: { id: "session-1" },
    task: { id: "task-1" },
    environment: "production",
    server: { id: "billing", transport: "function" },
    tool: { name: "billing.refund", capabilities: ["finance.refund"] },
    arguments: { paymentId: "pay-1", amount: 5000 },
    resources: [{ type: "payment", id: "pay-1", tenantId: "tenant-a" }],
    ...overrides
  };
}

describe("approval grants", () => {
  it("resumes a semantically identical action and rejects replay", async () => {
    const signer = createHmacApprovalSigner({ secret, issuer: "test" });
    const runtime = await createDvar({
      policy: policy(),
      approval: { signer, useStore: new InMemoryApprovalUseStore() }
    });
    const first = await runtime.evaluate(action());
    expect(first.effect).toBe("require_approval");
    expect(first.approvalRequest?.scope).toBe("once");

    const grant = await signer.issue(first.approvalRequest!, {
      approver: { id: "reviewer-1", type: "user" }
    });
    const resumed = await runtime.resume(
      action({ id: "retry-with-new-id" }),
      grant.token
    );
    expect(resumed).toMatchObject({
      effect: "allow",
      reasonCode: "approval.grant_accepted",
      approval: { status: "accepted", approverId: "reviewer-1" }
    });

    const replayed = await runtime.resume(action({ id: "retry-2" }), grant.token);
    expect(replayed).toMatchObject({
      effect: "deny",
      reasonCode: "approval.grant_replayed"
    });
  });

  it("rejects tampered grants and changed bound arguments", async () => {
    const signer = createHmacApprovalSigner({ secret, issuer: "test" });
    const runtime = await createDvar({
      policy: policy(),
      approval: { signer, useStore: new InMemoryApprovalUseStore() }
    });
    const request = (await runtime.evaluate(action())).approvalRequest!;
    const grant = await signer.issue(request, {
      approver: { id: "reviewer-1" }
    });

    await expect(runtime.resume(
      action({
        id: "changed",
        arguments: { paymentId: "pay-1", amount: 9000 }
      }),
      grant.token
    )).resolves.toMatchObject({
      effect: "deny",
      reasonCode: "approval.binding_mismatch"
    });

    const tampered = `${grant.token.slice(0, -1)}${grant.token.endsWith("a") ? "b" : "a"}`;
    await expect(runtime.resume(action(), tampered)).resolves.toMatchObject({
      effect: "deny",
      reasonCode: "approval.grant_invalid"
    });
  });

  it("supports bounded session grants without binding arguments", async () => {
    const signer = createHmacApprovalSigner({ secret, issuer: "test" });
    const runtime = await createDvar({
      policy: policy("session", 2),
      approval: { signer, useStore: new InMemoryApprovalUseStore() }
    });
    const request = (await runtime.evaluate(action())).approvalRequest!;
    const grant = await signer.issue(request, {
      approver: { id: "reviewer-1" },
      maxUses: 2
    });

    await expect(runtime.resume(action({
      id: "session-use-1",
      arguments: { paymentId: "pay-2", amount: 100 }
    }), grant.token)).resolves.toMatchObject({ effect: "allow" });
    await expect(runtime.resume(action({
      id: "session-use-2",
      arguments: { paymentId: "pay-3", amount: 200 }
    }), grant.token)).resolves.toMatchObject({ effect: "allow" });
    await expect(runtime.resume(action({ id: "session-use-3" }), grant.token))
      .resolves.toMatchObject({ effect: "deny", reasonCode: "approval.grant_replayed" });
  });

  it("auto-resumes a protected tool after immediate provider approval", async () => {
    const signer = createHmacApprovalSigner({ secret, issuer: "test" });
    const provider: DvarApprovalProvider = {
      name: "test",
      request: async (request) => ({
        status: "approved",
        requestId: request.id,
        grant: (await signer.issue(request, {
          approver: { id: "reviewer-1" }
        })).token
      })
    };
    const events: unknown[] = [];
    const runtime = await createDvar({
      policy: policy(),
      approval: { signer, provider, useStore: new InMemoryApprovalUseStore() },
      eventSink: (event) => { events.push(event); }
    });
    const execute = vi.fn(async () => ({ refunded: true }));
    const protectedRefund = runtime.protectTool({
      name: "billing.refund",
      capabilities: ["finance.refund"],
      execute
    });

    await expect(protectedRefund(
      { paymentId: "pay-1", amount: 5000 },
      {
        principal: { id: "user-1", type: "user" },
        agent: { id: "finance-agent" },
        environment: "production",
        tenant: { id: "tenant-a" }
      }
    )).resolves.toEqual({ refunded: true });
    expect(execute).toHaveBeenCalledOnce();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "dvar.approval.requested" }),
      expect.objectContaining({ type: "dvar.approval.consumed" })
    ]));
  });

  it("surfaces provider rejection without executing the tool", async () => {
    const signer = createHmacApprovalSigner({ secret, issuer: "test" });
    const runtime = await createDvar({
      policy: policy(),
      approval: {
        signer,
        provider: {
          name: "test",
          request: async (request) => ({
            status: "rejected",
            requestId: request.id,
            reason: "Insufficient evidence"
          })
        }
      }
    });
    const execute = vi.fn();
    const protectedRefund = runtime.protectTool({
      name: "billing.refund",
      capabilities: ["finance.refund"],
      execute
    });

    await expect(protectedRefund({}, {
      principal: { id: "user-1", type: "user" },
      agent: { id: "finance-agent" },
      environment: "production"
    })).rejects.toBeInstanceOf(DvarApprovalRejectedError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("never places a raw grant into audit events", async () => {
    const signer = createHmacApprovalSigner({ secret, issuer: "test" });
    const events: unknown[] = [];
    const runtime = await createDvar({
      policy: policy(),
      approval: { signer, useStore: new InMemoryApprovalUseStore() },
      eventSink: (event) => { events.push(event); }
    });
    const request = (await runtime.evaluate(action())).approvalRequest!;
    const grant = await signer.issue(request, { approver: { id: "reviewer-1" } });
    await runtime.resume(action(), grant.token);
    expect(JSON.stringify(events)).not.toContain(grant.token);
  });
});
