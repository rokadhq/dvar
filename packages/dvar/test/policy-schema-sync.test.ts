import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DVAR_POLICY_SCHEMA } from "../src/policy/schema.js";

describe("published policy schema", () => {
  it("matches the runtime TypeScript schema", async () => {
    const source = await readFile(
      new URL("../schema/dvar.policy.schema.json", import.meta.url),
      "utf8"
    );
    expect(JSON.parse(source)).toEqual(DVAR_POLICY_SCHEMA);
  });
});
