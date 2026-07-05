import { describe, expect, it, vi } from "vitest";
import {
  applyOpenAIAgentsApproval,
  createOpenAIAgentsNeedsApproval,
  resolveOpenAIAgentsInterruptions
} from "../src/adapters/openai-agents.js";
import type { DvarAction, DvarDecision } from "../src/types.js";

const action: DvarAction = {
  id: "action-1",
  principal: { id: "user-1", type: "user" },
  agent: { id: "agent-1" },
  environment: "production",
  server: { id: "local" },
  tool: { name: "records.delete" },
  arguments: {}
};

const decision: DvarDecision = {
  id: "decision-1",
  effect: "require_approval",
  mode: "enforce",
  ruleId: "approval-rule",
  reasonCode: "approval.required",
  message: "Approval required",
  risk: { level: "high", score: 80, signals: [] },
  obligations: [],
  policyVersion: "1",
  policyHash: "policy-hash",
  actionHash: "action-hash",
  evaluatedAt: new Date().toISOString(),
  durationMs: 1
};

describe("OpenAI Agents adapter", () => {
  it("maps Dvar decisions into needsApproval", async () => {
    const evaluate = vi.fn(async () => decision);
    const needsApproval = createOpenAIAgentsNeedsApproval({
      evaluate,
      toAction: async () => action
    });
    await expect(needsApproval({}, {})).resolves.toBe(true);
    expect(evaluate).toHaveBeenCalledWith(action);
  });

  it("applies approval and rejection to compatible run states", async () => {
    const state = { approve: vi.fn(), reject: vi.fn() };
    const first = { name: "delete" };
    applyOpenAIAgentsApproval(state, first, {
      status: "approved",
      always: true
    });
    expect(state.approve).toHaveBeenCalledWith(first, { alwaysApprove: true });

    await resolveOpenAIAgentsInterruptions(
      state,
      [{ name: "refund" }],
      async () => ({ status: "rejected", message: "Not approved" })
    );
    expect(state.reject).toHaveBeenCalledWith(
      { name: "refund" },
      { message: "Not approved" }
    );
  });
});
