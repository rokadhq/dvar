import { createDvar } from "@rokadhq/dvar";

const dvar = await createDvar({ policyPath: new URL("./dvar.yaml", import.meta.url).pathname });

const readCustomer = dvar.protectTool({
  name: "crm.read_customer",
  capabilities: ["data.read"],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["customerId"],
    properties: { customerId: { type: "string", minLength: 1 } }
  },
  execute: async ({ customerId }) => ({ customerId, status: "active" })
});

const result = await readCustomer(
  { customerId: "customer-1" },
  {
    principal: { id: "user-1", type: "user" },
    agent: { id: "support-agent" },
    tenant: { id: "tenant-a" },
    environment: "development",
    resources: [{ type: "customer", id: "customer-1", tenantId: "tenant-a" }]
  }
);

console.log(result);
