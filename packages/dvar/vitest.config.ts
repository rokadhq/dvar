import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      exclude: ["src/cli.ts", "src/types.ts", "src/index.ts", "src/policy/schema.ts"],
      thresholds: {
        statements: 75,
        branches: 65,
        functions: 80,
        lines: 75
      }
    }
  }
});
