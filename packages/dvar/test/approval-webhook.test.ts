import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWebhookApprovalProvider
} from "../src/approvals/index.js";
import type { DvarApprovalRequest } from "../src/types.js";

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()!;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
  }
});

const request = {
  version: "1",
  id: "request-1",
  actionId: "action-1",
  decisionId: "decision-1",
  actionHash: "action-hash",
  policyHash: "policy-hash",
  policyVersion: "1",
  ruleId: "approval-rule",
  provider: "webhook",
  scope: "once",
  bind: ["$actionHash"],
  bindings: { "$actionHash": "hash" },
  requestedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  maxUses: 1,
  principal: { id: "user-1", type: "user" },
  agent: { id: "agent-1" },
  environment: "production",
  server: { id: "local" },
  tool: { name: "records.delete" },
  arguments: { id: "record-1" },
  argumentsHash: "arguments-hash",
  summary: "Delete record",
  risk: { level: "high", score: 80, signals: ["destructive"] }
} satisfies DvarApprovalRequest;

describe("webhook approval provider", () => {
  it("posts a structured request and accepts pending responses", async () => {
    let received: unknown;
    const server = createServer(async (incoming, response) => {
      let source = "";
      for await (const chunk of incoming) source += chunk.toString();
      received = JSON.parse(source);
      response.statusCode = 202;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ status: "pending", requestId: request.id }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No address");
    const provider = createWebhookApprovalProvider({
      endpoint: `http://127.0.0.1:${address.port}/approvals`
    });

    await expect(provider.request(request)).resolves.toEqual({
      status: "pending",
      requestId: request.id
    });
    expect(received).toMatchObject({ version: "1", request: { id: request.id } });
  });

  it("rejects non-loopback plaintext endpoints", () => {
    expect(() => createWebhookApprovalProvider({
      endpoint: "http://approval.example.test/requests"
    })).toThrow(/HTTPS/u);
  });
});
