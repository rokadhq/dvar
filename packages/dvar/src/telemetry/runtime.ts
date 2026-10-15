import { modeValue, own } from "./privacy.js";
import type { DvarOpenTelemetryBridge, DvarTelemetryMetadata, DvarTelemetryOperation } from "./types.js";

const OPERATIONS: Readonly<Record<string, DvarTelemetryOperation>> = {
  evaluate: "evaluate", authorize: "authorize", resume: "resume",
  commitRuntime: "quota", requestApproval: "approval", recordOutcome: "outcome"
};
function text(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function metadata(action: unknown, mode: string): DvarTelemetryMetadata {
  const toolName = text(own(own(action, "tool"), "name"));
  const agentName = text(own(own(action, "agent"), "id"));
  return { mode, ...(toolName === undefined ? {} : { toolName }), ...(agentName === undefined ? {} : { agentName }) };
}

/** Observe the existing runtime, never reimplement or bypass its enforcement.
 * Also attach bridge.eventSink when constructing createDvar to capture internal
 * decision, approval and output observations. Existing audit sinks stay separate.
 */
export function instrumentDvarRuntime<T extends object>(runtime: T, bridge: DvarOpenTelemetryBridge): T {
  for (const method of ["evaluate", "authorize", "protectTool"]) {
    if (typeof Reflect.get(runtime, method) !== "function") throw new TypeError("Expected a Dvar runtime.");
  }
  if (typeof bridge?.run !== "function") throw new TypeError("Expected an OpenTelemetry bridge.");
  const cached = new Map<PropertyKey, unknown>();
  const mode = (): string => modeValue(own(Reflect.get(runtime, "policy"), "mode"));
  // An empty proxy target also supports a frozen source runtime without violating
  // the proxy invariant for non-writable, non-configurable function properties.
  return new Proxy({} as T, {
    has: (_target, key) => Reflect.has(runtime, key),
    ownKeys: () => Reflect.ownKeys(runtime),
    getPrototypeOf: () => Reflect.getPrototypeOf(runtime),
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(runtime, key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    set: (_target, key, value) => Reflect.set(runtime, key, value),
    get(_target, key) {
      if (cached.has(key)) return cached.get(key);
      const original = Reflect.get(runtime, key);
      if (typeof original !== "function") return original;
      let wrapped: unknown;
      if (key === "protectTool") {
        wrapped = function (definition: object, ...rest: unknown[]) {
          const execute = Reflect.get(definition, "execute");
          const toolName = text(own(definition, "name"));
          if (typeof execute !== "function") return Reflect.apply(original, runtime, [definition, ...rest]);
          const instrumented = {
            ...definition,
            execute: function (...args: unknown[]) {
              const agentName = text(own(own(args[1], "agent"), "id"));
              return bridge.run("tool", { mode: mode(), ...(toolName === undefined ? {} : { toolName }),
                ...(agentName === undefined ? {} : { agentName }) }, () => Reflect.apply(execute, definition, args));
            }
          };
          const protectedTool: unknown = Reflect.apply(original, runtime, [instrumented, ...rest]);
          if (typeof protectedTool !== "function") throw new TypeError("Dvar protectTool did not return an executor.");
          return function (this: unknown, ...args: unknown[]) {
            const agentName = text(own(own(args[1], "agent"), "id"));
            return bridge.run("action", { mode: mode(), ...(toolName === undefined ? {} : { toolName }),
              ...(agentName === undefined ? {} : { agentName }) }, () => Reflect.apply(protectedTool, this, args));
          };
        };
      } else if (typeof key === "string" && Object.hasOwn(OPERATIONS, key)) {
        const operation = OPERATIONS[key]!;
        wrapped = (...args: unknown[]) => bridge.run(operation, metadata(args[0], mode()),
          () => Reflect.apply(original, runtime, args));
      } else {
        // Do not cache arbitrary user keys: there are only seven observed methods.
        return original.bind(runtime);
      }
      cached.set(key, wrapped);
      return wrapped;
    }
  });
}
