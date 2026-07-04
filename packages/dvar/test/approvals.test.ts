import { describe, expect, it } from "vitest";
import {
  InMemoryApprovalUseStore,
  createDvar,
  createHmacApprovalSigner
} from "../src/index.js";
import type { DvarAction, DvarPolicy, DvarToolContext } from "../src/index.js";

const secret = "0123456789abcdef0123456789abcdef";

type ApprovalScope = "once" | "session" | "task";

function approvalBind(scope: ApprovalScope): string[] | undefined {
  if (scope === "session") return ["principal.id", "environment", "tool.name", "session.id"];
  if (scope === "task") return ["principal.id", "environment", "tool.name", "task.id"];
  return undefined;
}

function policy(scope: ApprovalScope = "once", maxUses = 1): DvarPolicy {
  const bind = approvalBind(scope);
  return {
    schemaVersion: "1",
    mode: "enforce",
    defaultEffect: "deny",
    rules: [{
      id: "approve-payments",
      effect: "require_approval",
      when: { "tool.name": "payments.refund" },
      approval: {
        provider: "manual",
        scope,
        maxUses,
        ...(bind !== undefined ? { bind } : {})
      }
    }]
  };
}

function action(overrides: Partial<DvarAction> = {}): DvarAction {
  return {
    id: "act-1",
    principal: { id: "user-1", type: "user" },
    agent: { id: "agent-1" },
    session: { id: "session-1" },
    task: { id: "task-1" },
    environment: "production",
    server: { id: "payments" },
    tool: { name: "payments.refund" },
    arguments: { paymentId: "pay-1", amount: 5000 },
    ...overrides
  };
}

function toolContextFrom(source: DvarAction): DvarToolContext {
  return {
    principal: source.principal,
    agent: source.agent,
    environment: source.environment,
    ...(source.session !== undefined ? { session: source.session } : {}),
    ...(source.task !== undefined ? { task: source.task } : {}),
    ...(source.tenant !== undefined ? { tenant: source.tenant } : {})
  };
}

function tamperSignature(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[2] === undefined || parts[2].length === 0) {
    throw new Error("Unexpected approval token format");
  }
  const replacement = parts[2][0] === "A" ? "B" : "A";
  return `${parts[0]}.${parts[1]}.${replacement}${parts[2].slice(1)}`;
}

describe("approval grants", () => {
  it("resumes a semantically identical action and rejects replay", async () => {
    const signer = createHmacApprovalSigner({ secret, issuer: "test" });
    const runtime = await createDvar({
      policy: policy(),
      approval: { signer, useStore: new InMemoryApprovalUseStore() }
    });
    const decision = await runtime.evaluate(action());
    expect(decision.effect).toBe("require_approval");
    const request = decision.approvalRequest!;
    const grant = await signer.issue(request, {
      approver: { id: "reviewer-1", type: "user" }
    });

    await expect(runtime.resume({ ...action(), id: "act-2" }, grant.token)).resolves.toMatchObject({
      effect: "allow",
      reasonCode: "approval.grant_accepted"
    });
    await expect(runtime.resume({ ...action(), id: "act-3" }, grant.token)).resolves.toMatchObject({
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

    await expect(runtime.resume(action(), tamperSignature(grant.token))).resolves.toMatchObject({
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

    await expect(runtime.resume(action({ id: "s1", arguments: { amount: 100 } }), grant.token)).resolves.toMatchObject({ effect: "allow" });
    await expect(runtime.resume(action({ id: "s2", arguments: { amount: 200 } }), grant.token)).resolves.toMatchObject({ effect: "allow" });
    await expect(runtime.resume(action({ id: "s3", arguments: { amount: 300 } }), grant.token)).resolves.toMatchObject({
      effect: "deny",
      reasonCode: "approval.grant_replayed"
    });
  });

  it("auto-resumes a protected tool after immediate provider approval", async () => {
    const signer = createHmacApprovalSigner({ secret, issuer: "test" });
    let calls = 0;
    const runtime = await createDvar({
      policy: policy(),
      approval: {
        signer,
        useStore: new InMemoryApprovalUseStore(),
        provider: {
          name: "manual",
          async request(request) {
            const grant = await signer.issue(request, { approver: { id: "reviewer-1" } });
            return { status: "approved", requestId: request.id, grant: grant.token };
          }
        }
      }
    });
    const tool = runtime.protectTool({
      name: "payments.refund",
      execute: () => {
        calls += 1;
        return { ok: true };
      }
    });
    const source = action();
    await expect(tool(source.arguments, toolContextFrom(source))).resolves.toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  it("surfaces provider rejection without executing the tool", async () => {
    const signer = createHmacApprovalSigner({ secret, issuer: "test" });
    let calls = 0;
    const runtime = await createDvar({
      policy: policy(),
      approval: {
        signer,
        provider: {
          name: "manual",
          async request(request) {
            return { status: "rejected", requestId: request.id, reason: "too risky" };
          }
        }
      }
    });
    const tool = runtime.protectTool({
      name: "payments.refund",
      execute: () => { calls += 1; return { ok: true }; }
    });
    await expect(tool({}, {
      principal: action().principal,
      agent: action().agent,
      environment: action().environment
    })).rejects.toMatchObject({ code: "approval.rejected" });
    expect(calls).toBe(0);
  });

  it("never places a raw grant into audit events", async () => {
    const events: unknown[] = [];
    const signer = createHmacApprovalSigner({ secret, issuer: "test" });
    const runtime = await createDvar({
      policy: policy(),
      eventSink: (event) => { events.push(event); },
      approval: { signer, useStore: new InMemoryApprovalUseStore() }
    });
    const request = (await runtime.evaluate(action())).approvalRequest!;
    const grant = await signer.issue(request, { approver: { id: "reviewer-1" } });
    await runtime.resume(action({ id: "audit" }), grant.token);
    expect(JSON.stringify(events)).not.toContain(grant.token);
  });
});
