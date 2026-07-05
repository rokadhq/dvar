import { describe, expect, it } from "vitest";
import { createDvar } from "../src/index.js";
import type { DvarAction, DvarAuditEvent } from "../src/index.js";

function action(): DvarAction {
  return {
    id: crypto.randomUUID(),
    principal: { id: "user-1", type: "user" },
    agent: { id: "agent-1" },
    task: { id: "task-1" },
    environment: "production",
    server: { id: "billing" },
    tool: { name: "billing.charge" },
    arguments: {}
  };
}

describe("runtime audit metadata", () => {
  it("emits bounded quota context without raw usage", async () => {
    const events: DvarAuditEvent[] = [];
    const runtime = await createDvar({
      policy: {
        schemaVersion: "1",
        mode: "enforce",
        defaultEffect: "allow",
        runtime: { maxToolCallsPerTask: 1 }
      },
      eventSink: (event) => { events.push(event); }
    });
    await runtime.authorize(action());
    await runtime.authorize(action());

    expect(events).toContainEqual(expect.objectContaining({
      type: "dvar.action.denied",
      reasonCode: "quota.exceeded",
      runtimeControl: "calls_per_task",
      runtimeStore: "memory",
      runtimeDistributed: false,
      runtimeCurrent: 1,
      runtimeLimit: 1
    }));
    expect(JSON.stringify(events)).not.toContain("monetaryValue");
  });
});
