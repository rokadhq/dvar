import { randomUUID } from "node:crypto";
import { sha256 } from "../canonical.js";
import { DvarConfigurationError } from "../errors.js";
import type { DvarRuntime } from "../runtime.js";
import type {
  DvarAction,
  DvarDecision,
  DvarToolContext,
  DvarToolDefinition
} from "../types.js";

export type VercelAISDKNeedsApproval<TInput, TExecutionOptions> =
  | boolean
  | ((input: TInput, options?: TExecutionOptions) => boolean | Promise<boolean>);

export interface VercelAISDKToolLike<TInput = unknown, TResult = unknown, TExecutionOptions = unknown> {
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  strict?: boolean;
  inputExamples?: unknown;
  needsApproval?: VercelAISDKNeedsApproval<TInput, TExecutionOptions>;
  execute?: (input: TInput, options?: TExecutionOptions) => TResult | Promise<TResult>;
  [key: string]: unknown;
}

export type VercelAISDKToolsLike = Record<string, VercelAISDKToolLike>;

export interface VercelAISDKContextInput<
  TInput = unknown,
  TTool extends VercelAISDKToolLike<TInput, unknown, TExecutionOptions> = VercelAISDKToolLike<TInput, unknown, TExecutionOptions>,
  TExecutionOptions = unknown
> {
  toolName: string;
  tool: TTool;
  input: TInput;
  executionOptions?: TExecutionOptions;
}

export type VercelAISDKContextResolver<
  TInput = unknown,
  TTool extends VercelAISDKToolLike<TInput, unknown, TExecutionOptions> = VercelAISDKToolLike<TInput, unknown, TExecutionOptions>,
  TExecutionOptions = unknown
> = (
  input: VercelAISDKContextInput<TInput, TTool, TExecutionOptions>
) => DvarToolContext | Promise<DvarToolContext>;

export interface VercelAISDKAdapterOptions<TExecutionOptions = unknown> {
  runtime: Pick<DvarRuntime, "evaluate" | "protectTool">;
  context?: DvarToolContext;
  contextResolver?: VercelAISDKContextResolver<unknown, VercelAISDKToolLike<unknown, unknown, TExecutionOptions>, TExecutionOptions>;
  namespace?: string;
  server?: DvarAction["server"];
  capabilities?: string[] | ((toolName: string, tool: VercelAISDKToolLike) => string[]);
  toDvarInputSchema?: (toolName: string, tool: VercelAISDKToolLike) => Record<string, unknown> | undefined;
  composeNeedsApproval?: boolean;
  onDecision?: (input: { action: DvarAction; decision: DvarDecision }) => void | Promise<void>;
}

function hasExecute(tool: VercelAISDKToolLike): tool is VercelAISDKToolLike & Required<Pick<VercelAISDKToolLike, "execute">> {
  return typeof tool.execute === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function looksLikeJsonSchema(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (typeof value.parse === "function" || typeof value.safeParse === "function" || "_def" in value) return false;
  return "$schema" in value
    || "type" in value
    || "properties" in value
    || "oneOf" in value
    || "anyOf" in value
    || "allOf" in value
    || "required" in value;
}

function dvarInputSchema(
  toolName: string,
  tool: VercelAISDKToolLike,
  options: VercelAISDKAdapterOptions
): Record<string, unknown> | undefined {
  const configured = options.toDvarInputSchema?.(toolName, tool);
  if (configured !== undefined) return configured;
  return looksLikeJsonSchema(tool.inputSchema) ? tool.inputSchema : undefined;
}

function capabilitiesFor(
  toolName: string,
  tool: VercelAISDKToolLike,
  configured: VercelAISDKAdapterOptions["capabilities"]
): string[] {
  if (typeof configured === "function") return configured(toolName, tool);
  return configured ?? [];
}

async function resolveContext<TExecutionOptions>(
  options: VercelAISDKAdapterOptions<TExecutionOptions>,
  input: VercelAISDKContextInput<unknown, VercelAISDKToolLike<unknown, unknown, TExecutionOptions>, TExecutionOptions>
): Promise<DvarToolContext> {
  if (options.contextResolver !== undefined) return options.contextResolver(input);
  if (options.context !== undefined) return options.context;
  throw new DvarConfigurationError("Vercel AI SDK adapter requires context or contextResolver");
}

function actionFrom(
  toolName: string,
  tool: VercelAISDKToolLike,
  input: unknown,
  context: DvarToolContext,
  options: VercelAISDKAdapterOptions,
  inputSchema: Record<string, unknown> | undefined
): DvarAction {
  return {
    id: randomUUID(),
    principal: context.principal,
    agent: {
      ...context.agent,
      framework: context.agent.framework ?? "vercel-ai-sdk"
    },
    ...(context.tenant !== undefined ? { tenant: context.tenant } : {}),
    ...(context.session !== undefined ? { session: context.session } : {}),
    ...(context.task !== undefined ? { task: context.task } : {}),
    environment: context.environment,
    server: options.server ?? { id: "vercel-ai-sdk", transport: "function" },
    tool: {
      name: toolName,
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
      capabilities: capabilitiesFor(toolName, tool, options.capabilities),
      ...(inputSchema !== undefined ? { schemaHash: sha256(inputSchema) } : {})
    },
    arguments: input,
    ...(context.resources !== undefined ? { resources: context.resources } : {}),
    ...(context.destination !== undefined ? { destination: context.destination } : {}),
    ...(context.trace !== undefined ? { trace: context.trace } : {}),
    metadata: {
      ...(context.metadata ?? {}),
      adapter: "vercel-ai-sdk"
    }
  };
}

async function originalNeedsApproval<TInput, TExecutionOptions>(
  needsApproval: VercelAISDKNeedsApproval<TInput, TExecutionOptions> | undefined,
  input: TInput,
  executionOptions?: TExecutionOptions
): Promise<boolean> {
  if (needsApproval === undefined) return false;
  if (typeof needsApproval === "boolean") return needsApproval;
  return needsApproval(input, executionOptions);
}

export function createVercelAISDKNeedsApproval<TInput = unknown, TExecutionOptions = unknown>(
  toolName: string,
  tool: VercelAISDKToolLike<TInput, unknown, TExecutionOptions>,
  options: VercelAISDKAdapterOptions<TExecutionOptions>
): (input: TInput, executionOptions?: TExecutionOptions) => Promise<boolean> {
  const inputSchema = dvarInputSchema(toolName, tool, options);
  return async (input, executionOptions) => {
    if (await originalNeedsApproval(tool.needsApproval, input, executionOptions)) return true;
    const context = await resolveContext(options, { toolName, tool: tool as VercelAISDKToolLike<unknown, unknown, TExecutionOptions>, input, ...(executionOptions !== undefined ? { executionOptions } : {}) });
    const action = actionFrom(toolName, tool, input, context, options, inputSchema);
    const decision = await options.runtime.evaluate(action);
    await options.onDecision?.({ action, decision });
    return decision.effect !== "allow" || decision.observedEffect === "would_require_approval";
  };
}

function protectedExecute<TInput, TResult, TExecutionOptions>(
  toolName: string,
  tool: VercelAISDKToolLike<TInput, TResult, TExecutionOptions> & Required<Pick<VercelAISDKToolLike<TInput, TResult, TExecutionOptions>, "execute">>,
  options: VercelAISDKAdapterOptions<TExecutionOptions>
): (input: TInput, executionOptions?: TExecutionOptions) => Promise<TResult> {
  const inputSchema = dvarInputSchema(toolName, tool, options);
  return async (input, executionOptions) => {
    const context = await resolveContext(options, { toolName, tool: tool as VercelAISDKToolLike<unknown, unknown, TExecutionOptions>, input, ...(executionOptions !== undefined ? { executionOptions } : {}) });
    const definition: DvarToolDefinition<TInput, TResult> = {
      name: toolName,
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
      capabilities: capabilitiesFor(toolName, tool, options.capabilities),
      ...(inputSchema !== undefined ? { inputSchema } : {}),
      ...(options.server !== undefined ? { server: options.server } : {}),
      execute: (arguments_) => tool.execute(arguments_, executionOptions)
    };
    const protectedTool = options.runtime.protectTool(definition);
    return protectedTool(input, {
      ...context,
      agent: {
        ...context.agent,
        framework: context.agent.framework ?? "vercel-ai-sdk"
      },
      metadata: {
        ...(context.metadata ?? {}),
        adapter: "vercel-ai-sdk"
      }
    });
  };
}

export function protectVercelAISDKTool<TInput = unknown, TResult = unknown, TExecutionOptions = unknown>(
  toolName: string,
  tool: VercelAISDKToolLike<TInput, TResult, TExecutionOptions>,
  options: VercelAISDKAdapterOptions<TExecutionOptions>
): VercelAISDKToolLike<TInput, TResult, TExecutionOptions> {
  const next: VercelAISDKToolLike<TInput, TResult, TExecutionOptions> = {
    ...tool,
    ...(options.composeNeedsApproval !== false
      ? { needsApproval: createVercelAISDKNeedsApproval(toolName, tool, options) }
      : {})
  };
  if (hasExecute(tool)) {
    next.execute = protectedExecute(toolName, tool, options);
  }
  return next;
}

export function protectVercelAISDKTools<
  TTools extends Record<string, VercelAISDKToolLike<unknown, unknown, TExecutionOptions>>,
  TExecutionOptions = unknown
>(
  tools: TTools,
  options: VercelAISDKAdapterOptions<TExecutionOptions>
): TTools {
  const protectedTools: Record<string, VercelAISDKToolLike> = {};
  for (const [toolName, tool] of Object.entries(tools)) {
    protectedTools[toolName] = protectVercelAISDKTool(toolName, tool, options);
  }
  return protectedTools as TTools;
}
