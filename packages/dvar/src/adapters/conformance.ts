export type DvarAdapterConformanceStatus = "passed" | "failed";

export interface DvarAdapterConformanceCase {
  name: string;
  run: () => void | Promise<void>;
}

export interface DvarAdapterConformanceResult {
  name: string;
  status: DvarAdapterConformanceStatus;
  error?: string;
}

export interface DvarAdapterConformanceSummary {
  passed: boolean;
  results: DvarAdapterConformanceResult[];
}

export async function runAdapterConformanceSuite(
  cases: readonly DvarAdapterConformanceCase[]
): Promise<DvarAdapterConformanceSummary> {
  const results: DvarAdapterConformanceResult[] = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      results.push({ name: testCase.name, status: "passed" });
    } catch (error) {
      results.push({
        name: testCase.name,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return {
    passed: results.every((result) => result.status === "passed"),
    results
  };
}
