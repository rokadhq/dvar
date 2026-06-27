import {
  DvarDeniedError,
  createDvar,
  loadPolicy
} from "@rokadhq/dvar";

const policyPath = new URL("./dvar.yaml", import.meta.url).pathname;
const policy = await loadPolicy(policyPath);
const context = {
  principal: { id: "user-1", type: "user" },
  agent: { id: "support-agent" },
  tenant: { id: "tenant-a" },
  environment: "development",
  resources: [{ type: "customer", id: "customer-1", tenantId: "tenant-a" }]
};

let deleteExecutions = 0;

const monitor = await createDvar({
  policy,
  eventSink: (event) => {
    if (event.toolName === "crm.delete_customer") {
      console.log("monitor decision", event.observedEffect, event.reasonCode);
    }
  }
});

const monitoredDelete = monitor.protectTool({
  name: "crm.delete_customer",
  capabilities: ["data.delete"],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["customerId"],
    properties: { customerId: { type: "string", minLength: 1 } }
  },
  execute: async ({ customerId }) => {
    deleteExecutions += 1;
    return { customerId, deleted: true };
  }
});

await monitoredDelete({ customerId: "customer-1" }, context);
console.log("monitor executed tool", deleteExecutions === 1);

const enforce = await createDvar({
  policy: { ...policy, mode: "enforce" }
});
const enforcedDelete = enforce.protectTool({
  name: "crm.delete_customer",
  capabilities: ["data.delete"],
  execute: async () => {
    deleteExecutions += 1;
    return { deleted: true };
  }
});

try {
  await enforcedDelete({ customerId: "customer-1" }, context);
} catch (error) {
  if (!(error instanceof DvarDeniedError)) throw error;
  console.log("enforce blocked tool", error.decision.reasonCode);
}

console.log("enforce prevented execution", deleteExecutions === 1);
