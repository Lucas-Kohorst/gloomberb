import { useCallback, useEffect, useRef, useState } from "react";
import { refreshBrowserAiState } from "../ai/browser";
import {
  getAiProvider,
  getAiProviderUnavailableReason,
  resolveDefaultAiProviderId,
  type AiProvider,
} from "../ai/providers";
import {
  checkAiProviderStatus,
  isAiRunCancelled,
  runAiPrompt,
  type AiRunController,
} from "../ai/runner";
import { useAiRuntimeProviders } from "../ai/use-runtime-providers";
import { feedLabel, filingKindLabel } from "./filings-format";
import type { CftcFiling } from "./types";

export const CFTC_SUMMARY_CONTENT_LIMIT = 12_000;

export const NO_CFTC_AI_PROVIDER_MESSAGE =
  "No AI provider is available. Connect an AI provider in Account Management → AI to summarize filings.";

const BROWSER_MODEL_DOWNLOAD_MESSAGE =
  "Chrome's on-device model is not downloaded yet. Open Account Management → AI and click Download model, then summarize again.";

export interface CftcFilingSummary {
  executiveSummary: string;
  keyPoints: string[];
  generatedAt: number;
  providerId: string;
  modelId?: string;
}

type SummaryAiRunner = (options: {
  providerId: string;
  prompt: string;
  modelId?: string;
  outputMode?: "plain";
  onChunk?: (output: string) => void;
}) => AiRunController;

const defaultRun: SummaryAiRunner = (options) => runAiPrompt({
  providerId: options.providerId,
  prompt: options.prompt,
  modelId: options.modelId,
  outputMode: options.outputMode ?? "plain",
  onChunk: options.onChunk,
});

function truncateContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= CFTC_SUMMARY_CONTENT_LIMIT) return trimmed;
  return `${trimmed.slice(0, CFTC_SUMMARY_CONTENT_LIMIT)}\n[...truncated...]`;
}

export function buildCftcSummaryPrompt(filing: CftcFiling, content: string): string {
  return [
    "Summarize this CFTC industry filing for a market professional.",
    "",
    `Title: ${filing.title}`,
    `Organization: ${filing.orgCode || "unknown"}`,
    `Type: ${filingKindLabel(filing)}`,
    `Status: ${filing.status || "unknown"}`,
    `Feed: ${feedLabel(filing)}`,
    "",
    "Return a JSON object with these fields:",
    '- "executiveSummary": three sentences covering what was filed and why it matters.',
    '- "keyPoints": an array of short bullets with the material facts (product, dates, confidential treatment, rule change).',
    "",
    "Guidelines:",
    "- Base every statement on the filing text. Do not invent facts.",
    "- If this is a confidential treatment or FOIA letter, say so plainly and note what is being withheld and for how long.",
    "- Output only the JSON object, no markdown fences or commentary.",
    "",
    "Filing text:",
    truncateContent(content),
  ].join("\n");
}

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidates: string[] = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fence) candidates.push(fence);
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  return null;
}

export function parseCftcSummaryResponse(raw: string): {
  executiveSummary: string;
  keyPoints: string[];
} {
  const parsed = tryParseJson(raw);
  if (parsed && typeof parsed === "object") {
    const payload = parsed as Record<string, unknown>;
    const executiveSummary = typeof payload.executiveSummary === "string"
      ? payload.executiveSummary.trim()
      : "";
    if (!executiveSummary) {
      throw new Error("AI summary did not include an executive summary.");
    }
    const keyPoints = Array.isArray(payload.keyPoints)
      ? payload.keyPoints
        .map((entry) => typeof entry === "string" ? entry.trim() : "")
        .filter((entry) => entry.length > 0)
      : [];
    return { executiveSummary, keyPoints };
  }
  const fallback = raw.trim();
  if (!fallback) throw new Error("AI summary response was empty.");
  return { executiveSummary: fallback, keyPoints: [] };
}

export function renderCftcSummary(summary: CftcFilingSummary): string {
  const lines = ["**AI Summary**", "", summary.executiveSummary];
  if (summary.keyPoints.length > 0) {
    lines.push("");
    for (const point of summary.keyPoints) lines.push(`- ${point}`);
  }
  return lines.join("\n");
}

async function resolveReadyProvider(providers: readonly AiProvider[]): Promise<AiProvider> {
  const providerId = resolveDefaultAiProviderId(providers);
  const provider = getAiProvider(providerId, providers);
  if (!provider) throw new Error(NO_CFTC_AI_PROVIDER_MESSAGE);
  if (provider.id === "browser-builtin") {
    const state = await refreshBrowserAiState();
    if (state.availability === "downloadable" || state.availability === "downloading") {
      throw new Error(BROWSER_MODEL_DOWNLOAD_MESSAGE);
    }
    if (state.availability !== "available") {
      throw new Error(getAiProviderUnavailableReason(provider));
    }
  } else if (!provider.available) {
    throw new Error(getAiProviderUnavailableReason(provider));
  }
  const status = await checkAiProviderStatus(provider);
  if (!status.available || (!status.authenticated && !status.inconclusive)) {
    throw new Error(status.message ?? `${provider.name} is not ready.`);
  }
  return provider;
}

export async function summarizeCftcFiling(options: {
  filing: CftcFiling;
  content: string;
  providers: readonly AiProvider[];
  run?: SummaryAiRunner;
}): Promise<CftcFilingSummary> {
  const provider = await resolveReadyProvider(options.providers);
  const run = options.run ?? defaultRun;
  let rawOutput = "";
  try {
    const controller = run({
      providerId: provider.id,
      prompt: buildCftcSummaryPrompt(options.filing, options.content),
      modelId: provider.defaultModelId ?? undefined,
      outputMode: "plain",
      onChunk: (output) => {
        rawOutput = output;
      },
    });
    const finalOutput = await controller.done;
    if (finalOutput.trim()) rawOutput = finalOutput;
  } catch (error) {
    if (isAiRunCancelled(error)) throw error;
    throw new Error(
      error instanceof Error ? `AI summary failed: ${error.message}` : "AI summary failed.",
    );
  }
  const parsed = parseCftcSummaryResponse(rawOutput);
  return {
    ...parsed,
    generatedAt: Date.now(),
    providerId: provider.id,
    modelId: provider.defaultModelId,
  };
}

export function useCftcFilingSummary() {
  const providers = useAiRuntimeProviders();
  const [summaries, setSummaries] = useState<Map<number, CftcFilingSummary>>(new Map());
  const [summarizingId, setSummarizingId] = useState<number | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    inflightRef.current?.abort();
  }, []);

  const summarize = useCallback(async (filing: CftcFiling, content: string) => {
    if (summarizingId != null) return;
    setSummaryError(null);
    setSummarizingId(filing.id);
    const controller = new AbortController();
    inflightRef.current?.abort();
    inflightRef.current = controller;
    try {
      const summary = await summarizeCftcFiling({ filing, content, providers });
      if (controller.signal.aborted) return;
      setSummaries((current) => new Map(current).set(filing.id, summary));
    } catch (error) {
      if (controller.signal.aborted || isAiRunCancelled(error)) return;
      setSummaryError(error instanceof Error ? error.message : "Failed to summarize filing.");
    } finally {
      if (inflightRef.current === controller) inflightRef.current = null;
      if (!controller.signal.aborted) setSummarizingId(null);
    }
  }, [providers, summarizingId]);

  return { summaries, summarizingId, summaryError, summarize };
}
