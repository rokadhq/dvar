import { randomUUID } from "node:crypto";
import { sha256 } from "../canonical.js";
import type { DvarAction, DvarToolContext, DvarToolDefinition } from "../types.js";
import { createCheckRunner } from "./checks.js";
import { DvarAuthorityError, fail, safeAuthorityReason } from "./errors.js";
import { checkIdentityTime, TRUST_LEVELS, validateIdentity } from "./identity.js";
import { checkOwnershipTime, projectResource, references, validateOwnership } from "./ownership.js";
import { number, record, same, snapshot, strings, text } from "./validation.js";
import type {
  DvarAuthorityBoundary, DvarAuthorityCallOptions, DvarAuthorityEvent, DvarAuthorityOptions,
  DvarAuthorityTool, DvarAuthorityToolDefinition, DvarOwnershipRecord, DvarResourceReference,
  DvarVerifiedIdentity, DvarVerifiedResource
} from "./types.js";

const CONFIG = "authority.configuration_invalid";

/** Opt-in application boundary. Authentication/ownership never fail open, even in Dvar monitor/off mode. */
export function createAuthorityBoundary(options: DvarAuthorityOptions): DvarAuthorityBoundary {
  if (!options || typeof options !== "object") fail(CONFIG);
  const runtime = options.runtime;
  if (!runtime || typeof runtime.evaluate !== "function" || typeof runtime.protectTool !== "function") fail(CONFIG);
  if (!options.identityVerifier || typeof options.identityVerifier.verify !== "function") fail(CONFIG);
  if (options.ownershipProvider !== undefined && typeof options.ownershipProvider.resolve !== "function") fail(CONFIG);
  if (options.clock !== undefined && typeof options.clock !== "function") fail(CONFIG);
  if (options.eventSink !== undefined && typeof options.eventSink !== "function") fail(CONFIG);
  const source = text(options.identityVerifier.id, CONFIG, 64);
  const ownershipSource = options.ownershipProvider === undefined ? undefined : text(options.ownershipProvider.id, CONFIG, 64);
  for (const id of [source, ownershipSource]) {
    if (id !== undefined && !/^[a-zA-Z][a-zA-Z0-9._-]*$/u.test(id)) fail(CONFIG);
  }
  // Keep application functions, but copy security configuration; later options mutation cannot loosen it.
  const verify = options.identityVerifier.verify.bind(options.identityVerifier);
  const resolve = options.ownershipProvider?.resolve.bind(options.ownershipProvider);
  const evaluate = runtime.evaluate.bind(runtime);
  const protect = runtime.protectTool.bind(runtime);
  const sink = options.eventSink;
  const clock = options.clock ?? Date.now;
  const identityPolicy = Object.freeze({
    allowedIssuers: Object.freeze(strings(options.allowedIssuers, CONFIG, 1, 32)),
    audience: text(options.audience, CONFIG, 512), environment: text(options.environment, CONFIG),
    maxIdentityAgeMs: number(options.maxIdentityAgeMs ?? 300_000, CONFIG, 1, 86_400_000)
  });
  const maxOwnershipAgeMs = number(options.maxOwnershipAgeMs ?? 5_000, CONFIG, 1, 60_000);
  const maxArgumentBytes = number(options.maxArgumentBytes ?? 65_536, CONFIG, 256, 1_048_576);
  const checks = createCheckRunner(
    number(options.providerTimeoutMs ?? 2_000, CONFIG, 1, 30_000),
    number(options.phaseTimeoutMs ?? 10_000, CONFIG, 1, 60_000),
    number(options.maxPendingChecks ?? 128, CONFIG, 1, 4096)
  );
  let lastTime = 0;
  let pendingEvents = 0;
  let droppedEvents = 0;
  const now = () => {
    let value: number;
    try { value = clock(); } catch { return fail("authority.clock_invalid"); }
    number(value, "authority.clock_invalid", lastTime);
    lastTime = value;
    return value;
  };
  // Events are diagnostic, not a delivery-guaranteed audit ledger. Never delay dispatch on a sink.
  function emit(type: DvarAuthorityEvent["type"], stage: DvarAuthorityEvent["stage"], reasonCode: string, count: number): void {
    if (!sink) return;
    if (pendingEvents >= 16) { droppedEvents += 1; return; }
    pendingEvents += 1;
    const event: DvarAuthorityEvent = Object.freeze({
      type, stage, source, ...(ownershipSource === undefined ? {} : { ownershipSource }),
      reasonCode, resourceCount: count
    });
    void Promise.resolve().then(() => sink(event)).catch(() => { droppedEvents += 1; })
      .finally(() => { pendingEvents -= 1; });
  }

  function callOptions(value: unknown, preview: boolean): DvarAuthorityCallOptions {
    const input = record(value, preview ? ["credential", "signal"] : ["credential", "signal", "approvalGrant"], "authority.context_invalid");
    if (input.credential === undefined || input.credential === "") fail("identity.missing");
    const credential = text(input.credential, "identity.invalid", 16_384);
    if (Buffer.byteLength(credential) > 16_384) fail("identity.invalid");
    const signal = input.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail("authority.context_invalid");
    const approvalGrant = input.approvalGrant === undefined ? undefined : text(input.approvalGrant, "authority.context_invalid", 32_768);
    return Object.freeze({ credential, ...(signal === undefined ? {} : { signal }),
      ...(approvalGrant === undefined ? {} : { approvalGrant }) });
  }

  async function identityFor(call: DvarAuthorityCallOptions, deadline: number): Promise<DvarVerifiedIdentity> {
    return checks.run(async signal => {
      let raw: unknown;
      try { raw = await verify(call.credential, { signal }); } catch { return fail("authority.provider_unavailable"); }
      return validateIdentity(raw, identityPolicy, now());
    }, call.signal, deadline);
  }

  async function owned(refs: readonly DvarResourceReference[], identity: DvarVerifiedIdentity, mode: "owner" | "tenant",
    call: DvarAuthorityCallOptions, deadline: number): Promise<readonly DvarOwnershipRecord[]> {
    if (!resolve) fail(CONFIG);
    const result: DvarOwnershipRecord[] = [];
    for (const ref of refs) {
      result.push(await checks.run(async signal => {
        let raw: unknown;
        try { raw = await resolve(ref, { identity, signal }); } catch { return fail("authority.provider_unavailable"); }
        return validateOwnership(raw, ref, identity, mode, now(), maxOwnershipAgeMs);
      }, call.signal, deadline));
    }
    return Object.freeze(result);
  }

  return Object.freeze({
    diagnostics: () => Object.freeze({ pendingChecks: checks.pending, pendingEvents, droppedEvents }),
    protectTool<TArguments, TResult>(definition: DvarAuthorityToolDefinition<TArguments, TResult>): DvarAuthorityTool<TArguments, TResult> {
      if (!definition || typeof definition.execute !== "function") fail(CONFIG);
      const name = text(definition.name, CONFIG);
      const namespace = definition.namespace === undefined ? undefined : text(definition.namespace, CONFIG);
      const capabilities = strings(definition.capabilities ?? [], CONFIG, 0, 128);
      const inputSchema = definition.inputSchema === undefined ? undefined : snapshot(definition.inputSchema, CONFIG, 65_536);
      const server = snapshot(definition.server ?? { id: "local", transport: "function" as const }, CONFIG, 8192);
      text(server.id, CONFIG);
      const resourceConfig = record(definition.resources, ["mode", "select"], CONFIG);
      const mode = resourceConfig.mode as "none" | "owner" | "tenant";
      if (mode !== "none" && mode !== "owner" && mode !== "tenant") fail(CONFIG);
      const select = mode === "none" ? undefined : definition.resources.mode === "none" ? undefined : definition.resources.select;
      if (mode !== "none" && (typeof select !== "function" || !resolve)) fail(CONFIG);
      if (mode === "none" && resourceConfig.select !== undefined) fail(CONFIG);
      const requiredRoles = strings(definition.requiredRoles ?? [], CONFIG);
      const trustLevels = strings(definition.allowedTrustLevels ?? TRUST_LEVELS, CONFIG, 1, 3);
      if (trustLevels.some(level => !TRUST_LEVELS.includes(level as typeof TRUST_LEVELS[number]))) fail(CONFIG);
      const executor = definition.execute;
      const staticDefinition = {
        name, capabilities,
        ...(namespace === undefined ? {} : { namespace }),
        ...(inputSchema === undefined ? {} : { inputSchema }), server
      };
      const tool = snapshot({
        name, capabilities,
        ...(namespace === undefined ? {} : { namespace }),
        ...(inputSchema === undefined ? {} : { schemaHash: sha256(inputSchema) })
      }, CONFIG);

      function checkRoles(identity: DvarVerifiedIdentity): void {
        if (requiredRoles.some(role => !identity.principal.roles.includes(role))) fail("identity.roles_denied");
        if (!trustLevels.includes(identity.agent.trustLevel)) fail("identity.trust_denied");
      }

      async function prepare(arguments_: TArguments, call: DvarAuthorityCallOptions) {
        const deadline = checks.deadline();
        checks.assert(call.signal, deadline);
        // Clone before the first await: caller mutations cannot change the policy-reviewed operation.
        const args = snapshot(arguments_, "authority.arguments_invalid", maxArgumentBytes);
        const identity = await identityFor(call, deadline);
        checkRoles(identity);
        let refs: readonly DvarResourceReference[] = Object.freeze([]);
        if (select) {
          let selection: unknown;
          try { selection = select(args, identity); } catch { return fail("ownership.references_invalid"); }
          if (selection instanceof Promise) {
            // This selector is intentionally synchronous. Observe accidental rejections before refusing it.
            void selection.catch(() => undefined);
            fail("ownership.references_invalid");
          }
          refs = references(selection);
        }
        const records = mode === "none" ? Object.freeze([]) : await owned(refs, identity, mode, call, deadline);
        const resources: DvarVerifiedResource[] = snapshot(records.map((entry, index) => projectResource(entry, refs[index]!)), "ownership.invalid");
        const context: DvarToolContext = snapshot({
          principal: {
            id: identity.principal.id, type: identity.principal.type, roles: [...identity.principal.roles],
            // Included in approvalActionHash via principal.claims, unlike unbound arbitrary metadata.
            claims: { dvarAuthority: {
              version: "1", source, issuer: identity.issuer, audience: identity.audience,
              agentRoles: [...identity.agent.roles], agentTrustLevel: identity.agent.trustLevel,
              issuedAtMs: identity.issuedAtMs, expiresAtMs: identity.expiresAtMs,
              resourceMode: mode, ...(ownershipSource === undefined ? {} : { ownershipSource })
            } }
          },
          agent: {
            id: identity.agent.id,
            ...(identity.agent.version === undefined ? {} : { version: identity.agent.version }),
            ...(identity.agent.framework === undefined ? {} : { framework: identity.agent.framework })
          },
          tenant: { id: identity.tenantId }, environment: identity.environment,
          ...(identity.sessionId === undefined ? {} : { session: { id: identity.sessionId } }),
          ...(identity.taskId === undefined ? {} : { task: { id: identity.taskId } }),
          ...(mode === "none" ? {} : { resources })
        }, "identity.invalid");
        const action: DvarAction = snapshot({
          id: randomUUID(), principal: context.principal, agent: context.agent,
          environment: context.environment, server, tool, arguments: args,
          ...(context.tenant === undefined ? {} : { tenant: context.tenant }),
          ...(context.session === undefined ? {} : { session: context.session }),
          ...(context.task === undefined ? {} : { task: context.task }),
          ...(context.resources === undefined ? {} : { resources: context.resources })
        }, "authority.arguments_invalid", maxArgumentBytes + 65_536);
        checks.assert(call.signal, deadline);
        const currentTime = now();
        checkIdentityTime(identity, currentTime, identityPolicy.maxIdentityAgeMs);
        records.forEach(entry => checkOwnershipTime(entry, currentTime, maxOwnershipAgeMs));
        return { args, identity, refs, resources, context, action };
      }

      const invoke = async (arguments_: TArguments, options_: DvarAuthorityCallOptions): Promise<TResult> => {
        let stage: DvarAuthorityEvent["stage"] = "prepare";
        let count = 0;
        try {
          const call = callOptions(options_, false);
          const prepared = await prepare(arguments_, call);
          count = prepared.resources.length;
          emit("dvar.authority.checked", stage, "authority.verified", count);
          let entered = false;
          // Each call has its own closure: no shared or model-supplied verified-context registry.
          const protectedDefinition: DvarToolDefinition<TArguments, TResult> = {
            ...staticDefinition,
            execute: async () => {
              if (entered) fail("authority.execution_replayed");
              entered = true;
              stage = "dispatch";
              const deadline = checks.deadline();
              const identity = await identityFor(call, deadline);
              checkRoles(identity);
              if (!same(identity, prepared.identity)) fail("identity.changed");
              const current = mode === "none" ? [] : await owned(prepared.refs, identity, mode, call, deadline);
              const projected = snapshot(current.map((entry, index) => projectResource(entry, prepared.refs[index]!)), "ownership.invalid");
              if (!same(projected, prepared.resources)) fail("ownership.changed");
              checks.assert(call.signal, deadline);
              const currentTime = now();
              checkIdentityTime(identity, currentTime, identityPolicy.maxIdentityAgeMs);
              current.forEach(entry => checkOwnershipTime(entry, currentTime, maxOwnershipAgeMs));
              emit("dvar.authority.checked", stage, "authority.verified", count);
              // No awaited observer or provider occurs between the final checks and executor invocation.
              return executor(prepared.args, Object.freeze({ identity, resources: projected,
                ...(call.signal === undefined ? {} : { signal: call.signal }) }));
            }
          };
          const protectedTool = protect(protectedDefinition);
          const context: DvarToolContext = call.approvalGrant === undefined ? prepared.context
            : Object.freeze({ ...prepared.context, approvalGrant: call.approvalGrant });
          return await protectedTool(prepared.args, context);
        } catch (error) {
          if (error instanceof DvarAuthorityError) emit("dvar.authority.denied", stage, safeAuthorityReason(error.code), count);
          // Dvar policy/approval/output errors and executor failures preserve their original semantics.
          throw error;
        }
      };
      const preview = async (arguments_: TArguments, options_: Omit<DvarAuthorityCallOptions, "approvalGrant">) => {
        try {
          const prepared = await prepare(arguments_, callOptions(options_, true));
          const decision = await evaluate(prepared.action);
          emit("dvar.authority.checked", "preview", "authority.verified", prepared.resources.length);
          return Object.freeze({ action: prepared.action, decision });
        } catch (error) {
          if (error instanceof DvarAuthorityError) emit("dvar.authority.denied", "preview", safeAuthorityReason(error.code), 0);
          throw error;
        }
      };
      Object.defineProperty(invoke, "evaluate", { value: preview, enumerable: true, writable: false, configurable: false });
      return Object.freeze(invoke) as DvarAuthorityTool<TArguments, TResult>;
    }
  });
}
