import type {
  DvarApprovalProvider,
  DvarApprovalProviderResult,
  DvarApprovalRequest
} from "../types.js";
import { DvarApprovalGrantError } from "./grant.js";

export interface WebhookApprovalProviderOptions {
  endpoint: string | URL;
  headers?: Record<string, string>;
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
  fetch?: typeof globalThis.fetch;
  name?: string;
}

function endpointUrl(
  value: string | URL,
  allowInsecureHttp: boolean
): URL {
  const url = value instanceof URL ? new URL(value) : new URL(value);
  const loopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "::1"
    || url.hostname === "[::1]";
  if (url.username !== "" || url.password !== "") {
    throw new DvarApprovalGrantError(
      "Approval endpoint user information is not supported",
      "approval.provider_invalid"
    );
  }
  if (
    url.protocol !== "https:"
    && !(url.protocol === "http:" && (loopback || allowInsecureHttp))
  ) {
    throw new DvarApprovalGrantError(
      "Approval endpoint must use HTTPS outside loopback",
      "approval.provider_invalid"
    );
  }
  return url;
}

function resultOf(
  value: unknown,
  requestId: string
): DvarApprovalProviderResult {
  if (value === null || typeof value !== "object") {
    throw new DvarApprovalGrantError(
      "Approval endpoint returned an invalid response",
      "approval.provider_invalid_response"
    );
  }
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (
    status !== "pending"
    && status !== "approved"
    && status !== "rejected"
  ) {
    throw new DvarApprovalGrantError(
      "Approval endpoint returned an invalid status",
      "approval.provider_invalid_response"
    );
  }
  if (status === "approved" && typeof record.grant !== "string") {
    throw new DvarApprovalGrantError(
      "Approved response is missing its grant",
      "approval.provider_invalid_response"
    );
  }
  return {
    status,
    requestId: typeof record.requestId === "string"
      ? record.requestId
      : requestId,
    ...(typeof record.grant === "string" ? { grant: record.grant } : {}),
    ...(typeof record.reason === "string" ? { reason: record.reason } : {})
  };
}

export function createWebhookApprovalProvider(
  options: WebhookApprovalProviderOptions
): DvarApprovalProvider {
  const endpoint = endpointUrl(
    options.endpoint,
    options.allowInsecureHttp ?? false
  );
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json");

  return {
    name: options.name ?? "webhook",
    async request(
      request: DvarApprovalRequest
    ): Promise<DvarApprovalProviderResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(endpoint, {
          method: "POST",
          headers,
          redirect: "error",
          body: JSON.stringify({ version: "1", request }),
          signal: controller.signal
        });
        if (!response.ok && response.status !== 202) {
          throw new DvarApprovalGrantError(
            `Approval endpoint returned HTTP ${response.status}`,
            "approval.provider_unavailable"
          );
        }
        return resultOf(await response.json(), request.id);
      } catch (error) {
        if (error instanceof DvarApprovalGrantError) throw error;
        throw new DvarApprovalGrantError(
          "Approval endpoint is unavailable",
          "approval.provider_unavailable",
          { cause: error }
        );
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
