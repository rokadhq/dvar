import type { DvarStdioPolicy } from "./types.js";

declare module "../types.js" {
  interface DvarPolicy {
    stdio?: DvarStdioPolicy;
  }
}
