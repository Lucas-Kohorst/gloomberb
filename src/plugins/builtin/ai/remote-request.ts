import type { RemoteControlRequest, RemoteControlResponse } from "../../../remote/types";
import { extractActionReceipts, type AiAgentHistoryMessage } from "./agent-history";

export function refuseUnsafeRemoteRequest(request: RemoteControlRequest): void {
  if (request.type === "call" && request.operation === "capability.invoke") {
    throw new Error("capability.invoke is not available to the agent. Use gloomberb_remote app operations or gloomberb_cli.");
  }
  if (request.type === "batch") {
    if (!Array.isArray(request.requests)) {
      throw new Error("batch request is missing requests.");
    }
    for (const step of request.requests) refuseUnsafeRemoteRequest(step);
  }
}

const REMOTE_REQUEST_TYPES = new Set([
  "help",
  "schema",
  "get",
  "data",
  "call",
  "patch",
  "batch",
]);

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? null,
  ].filter((candidate): candidate is string => !!candidate);
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next parse candidate
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseRemoteControlRequest(raw: string): RemoteControlRequest | null {
  return coerceRemoteControlRequest(tryParseJson(raw));
}

export function coerceRemoteControlRequest(value: unknown): RemoteControlRequest | null {
  if (!isRecord(value)) return null;
  if (
    value.type === undefined
    && isRecord(value.request)
    && typeof value.request.type === "string"
  ) {
    return coerceRemoteControlRequest(value.request);
  }
  if (typeof value.type !== "string" || !REMOTE_REQUEST_TYPES.has(value.type)) return null;
  if (value.type === "call" && typeof value.operation !== "string") return null;
  if (value.type === "get" && typeof value.resource !== "string") return null;
  if (value.type === "data" && typeof value.operation !== "string") return null;
  if (value.type === "patch" && (typeof value.resource !== "string" || !Array.isArray(value.patch))) return null;
  if (value.type !== "batch") return value as RemoteControlRequest;

  const steps = Array.isArray(value.requests)
    ? value.requests
    : Array.isArray(value.request)
      ? value.request
      : null;
  if (!steps) return null;
  const requests: RemoteControlRequest[] = [];
  for (const step of steps) {
    const coerced = coerceRemoteControlRequest(step);
    if (!coerced) return null;
    requests.push(coerced);
  }
  const { request: _singular, ...rest } = value;
  return { ...rest, type: "batch", requests } as RemoteControlRequest;
}

export function summarizeRemoteResponse(response: RemoteControlResponse): string {
  if (!response.ok) return response.error.message;
  if (response.data === undefined) return "ok";
  try {
    return JSON.stringify(response.data);
  } catch {
    return "ok";
  }
}

function syntheticHistory(request: RemoteControlRequest): AiAgentHistoryMessage[] {
  return remoteActionHistory(request, { ok: true, data: {} }, "visible");
}

function labelsForRequest(request: RemoteControlRequest): string[] {
  if (request.type === "batch") {
    return request.requests.flatMap(labelsForRequest);
  }
  const receipts = extractActionReceipts(syntheticHistory(request));
  if (receipts.length > 0) return receipts.map((receipt) => receipt.label);
  if (request.type === "get") return [`Read ${request.resource}.`];
  if (request.type === "help") return ["Read remote help."];
  if (request.type === "schema") return ["Read remote schema."];
  if (request.type === "data") return [`Fetched ${request.operation}.`];
  if (request.type === "call") return [request.operation];
  if (request.type === "patch") return [`Patched ${request.resource}.`];
  return [];
}

export function visibleRemoteApplyOutput(
  request: RemoteControlRequest,
  response: RemoteControlResponse,
): string {
  if (!response.ok) return response.error.message;
  const labels = labelsForRequest(request);
  return labels.length > 0 ? labels.join(" · ") : "Done.";
}

export function remoteActionHistory(
  request: RemoteControlRequest,
  response: RemoteControlResponse,
  id = `remote-${Date.now()}`,
): AiAgentHistoryMessage[] {
  return [
    {
      role: "assistant",
      content: [{
        type: "toolCall",
        id,
        name: "gloomberb_remote",
        arguments: { request },
      }],
    },
    {
      role: "toolResult",
      toolCallId: id,
      toolName: "gloomberb_remote",
      content: [{ type: "text", text: summarizeRemoteResponse(response) }],
      isError: !response.ok,
    },
  ];
}

export async function applyRemoteControlText(
  raw: string,
  sendRequest: (request: RemoteControlRequest) => Promise<RemoteControlResponse>,
  onAgentMessages?: (messages: AiAgentHistoryMessage[]) => void,
): Promise<{ applied: boolean; output: string }> {
  const request = parseRemoteControlRequest(raw);
  if (!request) return { applied: false, output: raw };
  refuseUnsafeRemoteRequest(request);
  const response = await sendRequest(request);
  const history = remoteActionHistory(request, response);
  onAgentMessages?.(history);
  return { applied: true, output: visibleRemoteApplyOutput(request, response) };
}
