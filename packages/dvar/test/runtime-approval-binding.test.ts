import { describe, expect, it } from "vitest";
import {
  InMemoryApprovalUseStore,
  createDvar,
  createHmacApprovalSigner
} from "../src/index.js";
import type { DvarAction } from "../src/index.js";

function action(value: number): DvarAction {
  return {
    id: crypto.randomUUID(),
    principal: { id: "user-1", type: "user" },
    agent: { id: "agent-1" },
    tenant: { id: "tenant-1" },
    environment: "production",
    server: { id: "billing" },
    tool: { name: "billing.charge" },
    arguments: { amount: 10 },
    usage: { monetaryValue: value, currency: "INR" }
  };
}

describe("runtime usage approval binding", () => {
  it("rejects usage changed after review", async () => {
    const signer = createHmacApprovalSigner({
      issuer: "test",
      secret: "0123456789abcdef0123456789abcdef"
    });
    const runtime = await createDvar({
      policy: {
        schemaVersion: "1",
        mode: "enforce",
        defaultEffect: "deny",
        rules: [{
          id: "approve-charge",
          effect: "require_approval",
          when: { "tool.name": "billing.charge" },
          approval: { provider: "manual", scope: "once" }
        }]
      },
      approval: {
        signer,
        useStore: new InMemoryApprovalUseStore()
      }
    });

    const reviewed = action(10);
    const request = (await runtime.evaluate(reviewed)).approvalRequest!;
    const grant = await signer.issue(request, {
      approver: { id: "reviewer-1" }
    });

    await expect(runtime.resume(action(20), grant.token)).resolves.toMatchObject({
      effect: "deny",
      reasonCode: "approval.binding_mismatch"
    });
  });
});
