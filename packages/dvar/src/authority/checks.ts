import { performance } from "node:perf_hooks";
import { DvarAuthorityError, fail } from "./errors.js";

/** Capacity is released only when the actual provider settles, not when its caller times out. */
export function createCheckRunner(timeoutMs: number, phaseTimeoutMs: number, maximum: number) {
  let pending = 0;
  return {
    get pending(): number { return pending; },
    deadline(): number { return performance.now() + phaseTimeoutMs; },
    assert(signal: AbortSignal | undefined, deadline: number): void {
      if (signal?.aborted) fail("authority.aborted");
      if (performance.now() >= deadline) fail("authority.timeout");
    },
    async run<T>(fn: (signal: AbortSignal) => Promise<T>, signal: AbortSignal | undefined, deadline: number): Promise<T> {
      this.assert(signal, deadline);
      if (pending >= maximum) fail("authority.capacity");
      const controller = new AbortController();
      const duration = Math.min(timeoutMs, deadline - performance.now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      pending += 1;
      const work = Promise.resolve().then(() => {
        this.assert(signal, deadline);
        if (controller.signal.aborted) fail("authority.timeout");
        return fn(controller.signal);
      }).finally(() => { pending -= 1; });
      const interruption = new Promise<never>((_resolve, reject) => {
        const stop = (code: "authority.timeout" | "authority.aborted") => {
          controller.abort();
          reject(new DvarAuthorityError(code));
        };
        timer = setTimeout(() => stop("authority.timeout"), Math.max(1, Math.ceil(duration)));
        onAbort = () => stop("authority.aborted");
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
      try {
        const result = await Promise.race([work, interruption]);
        this.assert(signal, deadline);
        if (controller.signal.aborted) fail("authority.timeout");
        return result;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
      }
    }
  };
}
