import type { AssistCommandCandidate, AssistCommandDescriptor, AssistCommandResponse } from "../../../api-client";
import { isHostedWebClient } from "../../../shared/hosted-api";
import { refreshBrowserAiState } from "./browser";
import { runAiPrompt } from "./runner";

const ASSIST_CANDIDATE_LIMIT = 3;

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? null,
  ].filter((candidate): candidate is string => Boolean(candidate));
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next extract
    }
  }
  return null;
}

export function buildBrowserAssistPrompt(
  query: string,
  commands: readonly AssistCommandDescriptor[],
): string {
  const inventory = commands.map((command) => {
    const arg = command.arg?.placeholder
      ? ` arg:${command.arg.placeholder}`
      : command.arg
        ? ` arg:${command.arg.kind}`
        : "";
    const description = command.description ? ` — ${command.description}` : "";
    return `${command.prefix}: ${command.name}${arg}${description}`;
  }).join("\n");
  return [
    "Map this Gloomberb command-bar query to up to 3 commands.",
    `Query: ${query.trim()}`,
    "Commands:",
    inventory,
    'Reply with JSON only: {"candidates":[{"input":"PREFIX args","title":"short title","prefix":"PREFIX","confidence":0.8}]}',
    "Use an exact PREFIX from the list. If nothing matches, return {\"candidates\":[]}.",
  ].join("\n");
}

export function parseAssistCommandOutput(
  raw: string,
  commands: readonly AssistCommandDescriptor[] = [],
): AssistCommandResponse {
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== "object") return { candidates: [] };
  const list = (parsed as { candidates?: unknown }).candidates;
  if (!Array.isArray(list)) return { candidates: [] };
  const allowed = new Set(commands.map((command) => command.prefix.toUpperCase()));
  const candidates: AssistCommandCandidate[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const input = typeof record.input === "string" ? record.input.trim() : "";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const prefix = typeof record.prefix === "string" ? record.prefix.trim().toUpperCase() : "";
    const confidence = typeof record.confidence === "number" ? record.confidence : 0;
    if (!input || !title || !prefix) continue;
    if (allowed.size > 0 && !allowed.has(prefix)) continue;
    candidates.push({ input, title, prefix, confidence });
    if (candidates.length >= ASSIST_CANDIDATE_LIMIT) break;
  }
  return { candidates };
}

/**
 * Hosted fallback when `/assist/command` is unavailable. Returns null when the
 * on-device model cannot run so the caller can surface the original RPC error.
 */
export async function runBrowserAssistCommand(
  query: string,
  commands: readonly AssistCommandDescriptor[],
  options?: { signal?: AbortSignal },
): Promise<AssistCommandResponse | null> {
  if (!isHostedWebClient()) return null;
  const state = await refreshBrowserAiState();
  if (state.availability !== "available") return null;
  const run = runAiPrompt({
    providerId: "browser-builtin",
    prompt: buildBrowserAssistPrompt(query, commands),
    outputMode: "plain",
  });
  const abort = () => run.cancel();
  if (options?.signal?.aborted) {
    run.cancel();
    return null;
  }
  options?.signal?.addEventListener("abort", abort, { once: true });
  try {
    const output = await run.done;
    return parseAssistCommandOutput(output, commands);
  } catch {
    return null;
  } finally {
    options?.signal?.removeEventListener("abort", abort);
  }
}
