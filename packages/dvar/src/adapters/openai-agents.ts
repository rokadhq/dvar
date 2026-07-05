import type {
  DvarAction,
  DvarDecision
} from "../types.js";

export interface OpenAIAgentsInterruptionLike {
  name: string;
  arguments?: unknown;
  agent?: { name?: string };
}

export interface OpenAIAgentsRunStateLike<
  TInterruption = OpenAIAgentsInterruptionLike
> {
  approve(
    interruption: TInterruption,
    options?: { alwaysApprove?: boolean }
  ): void;
  reject(
    interruption: TInterruption,
    options?: {
      alwaysReject?: boolean;
      message?: string;
    }
  ): void;
}

export interface OpenAIAgentsApprovalResolution {
  status: "approved" | "rejected";
  always?: boolean;
  message?: string;
}

export function applyOpenAIAgentsApproval<TInterruption>(
  state: OpenAIAgentsRunStateLike<TInterruption>,
  interruption: TInterruption,
  resolution: OpenAIAgentsApprovalResolution
): void {
  if (resolution.status === "approved") {
    state.approve(
      interruption,
      resolution.always === true ? { alwaysApprove: true } : undefined
    );
    return;
  }
  state.reject(interruption, {
    ...(resolution.always === true ? { alwaysReject: true } : {}),
    ...(resolution.message !== undefined
      ? { message: resolution.message }
      : {})
  });
}

export interface OpenAIAgentsDvarEvaluatorOptions<
  TRunContext,
  TArguments
> {
  evaluate(action: DvarAction): Promise<DvarDecision>;
  toAction(
    runContext: TRunContext,
    arguments_: TArguments
  ): DvarAction | Promise<DvarAction>;
  onDecision?: (input: {
    action: DvarAction;
    decision: DvarDecision;
  }) => void | Promise<void>;
}

export function createOpenAIAgentsNeedsApproval<
  TRunContext,
  TArguments
>(
  options: OpenAIAgentsDvarEvaluatorOptions<TRunContext, TArguments>
): (
  runContext: TRunContext,
  arguments_: TArguments
) => Promise<boolean> {
  return async (runContext, arguments_) => {
    const action = await options.toAction(runContext, arguments_);
    const decision = await options.evaluate(action);
    await options.onDecision?.({ action, decision });
    return decision.effect === "require_approval"
      || decision.observedEffect === "would_require_approval";
  };
}

export async function resolveOpenAIAgentsInterruptions<TInterruption>(
  state: OpenAIAgentsRunStateLike<TInterruption>,
  interruptions: readonly TInterruption[],
  resolver: (
    interruption: TInterruption
  ) => OpenAIAgentsApprovalResolution
    | Promise<OpenAIAgentsApprovalResolution>
): Promise<void> {
  for (const interruption of interruptions) {
    applyOpenAIAgentsApproval(
      state,
      interruption,
      await resolver(interruption)
    );
  }
}
