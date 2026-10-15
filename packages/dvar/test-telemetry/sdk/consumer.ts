import { context, trace, ROOT_CONTEXT } from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { createOpenTelemetryBridge } from "../../src/telemetry/index.js";

const bridge = createOpenTelemetryBridge({
  tracer: new BasicTracerProvider().getTracer("dvar.consumer"),
  meter: new MeterProvider().getMeter("dvar.consumer"),
  context, trace, rootContext: ROOT_CONTEXT
});
const result: Promise<number> = bridge.run("tool", { mode: "enforce" }, () => 42);
void result;
bridge.close();
