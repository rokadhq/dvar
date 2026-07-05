import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      mcp: "src/mcp/index.ts",
      approvals: "src/approvals/index.ts",
      "runtime-safety": "src/runtime-safety/index.ts",
      stdio: "src/stdio/index.ts",
      "output-guard": "src/output-guard/index.ts",
      "vercel-ai-sdk": "src/adapters/vercel-ai-sdk.ts",
      "adapter-conformance": "src/adapters/conformance.ts",
      "openai-agents": "src/adapters/openai-agents.ts"
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node20",
    platform: "node",
    splitting: false,
    treeshake: true
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    clean: false,
    target: "node20",
    platform: "node",
    splitting: false,
    treeshake: true,
    banner: { js: "#!/usr/bin/env node" }
  }
]);
