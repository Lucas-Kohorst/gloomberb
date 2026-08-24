import type { SecFilingItem } from "../../../types/data-provider";
import { refreshBrowserAiState } from "../ai/browser";
import { getAiProvider, getAiProviderUnavailableReason, resolveDefaultAiProviderId, type AiProvider } from "../ai/providers";
import {
  checkAiProviderStatus,
  isAiRunCancelled,
  runAiPrompt,
  type AiRunController,
} from "../ai/runner";
import {
  buildFilingSummaryPrompt,
  detectRedFlags,
  findPriorComparableFiling,
  parseFilingSummaryResponse,
  type FilingSummary,
} from "./summary-contract";
import {
  readSecSummaryCache,
  writeSecSummaryCache,
} from "./summary-cache";

export { isAiRunCancelled } from "../ai/runner";

/**
 * Injectable AI runner so tests can mock the provider call without the native
 * runtime. Mirrors the shape of `runAiPrompt`'s return.
 */
export type SummaryAiRunner = (options: {
  providerId: string;
  prompt: string;
  modelId?: string;
  outputMode?: "plain";
  onChunk?: (output: string) => void;
}) => AiRunController;

export interface SummarizeFilingArgs {
  filing: SecFilingItem;
  content: string;
  /** Other filings of the same form, used to find the prior comparable filing. */
  filings?: readonly SecFilingItem[];
  /** Cached content for prior filings, keyed by accession number. */
  contentCache?: ReadonlyMap<string, string | null>;
  providers?: readonly AiProvider[];
  /** Override for tests; defaults to the shared `runAiPrompt`. */
  run?: SummaryAiRunner;
  /** Skip a fresh cache entry and regenerate. */
  force?: boolean;
  onChunk?: (output: string) => void;
}

export interface SummarizeFilingResult {
  summary: FilingSummary;
  /** True when a cached summary was served without a new AI call. */
  cached: boolean;
  providerId: string;
  modelId?: string;
}

const defaultRun: SummaryAiRunner = (options) => runAiPrompt({
  providerId: options.providerId,
  prompt: options.prompt,
  modelId: options.modelId,
  outputMode: options.outputMode ?? "plain",
  onChunk: options.onChunk,
});

export const NO_AI_PROVIDER_MESSAGE =
  "No AI provider is available. Connect an AI provider in AI settings to summarize filings.";

export const BROWSER_MODEL_DOWNLOAD_MESSAGE =
  "Chrome's on-device model is not downloaded yet. Open Account Management → AI and click Download model, then summarize again.";

function resolveProvider(providers: readonly AiProvider[]): AiProvider {
  const providerId = resolveDefaultAiProviderId(providers);
  const provider = getAiProvider(providerId, providers);
  if (!provider) {
    throw new Error(NO_AI_PROVIDER_MESSAGE);
  }
  return provider;
}

/**
 * Generates (or serves a cached) AI summary for a single SEC filing. Handles
 * provider readiness checks, prompt construction, response parsing, local
 * red-flag detection, and persistence caching with a TTL.
 */
export async function summarizeFiling({
  filing,
  content,
  filings,
  contentCache,
  providers,
  run = defaultRun,
  force = false,
  onChunk,
}: SummarizeFilingArgs): Promise<SummarizeFilingResult> {
  if (!force) {
    const cached = readSecSummaryCache(filing.accessionNumber);
    if (cached && !cached.stale) {
      return {
        summary: cached.summary,
        cached: true,
        providerId: cached.summary.providerId,
        modelId: cached.summary.modelId,
      };
    }
  }

  const resolvedProviders = providers ?? [];
  const provider = resolveProvider(resolvedProviders);
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

  try {
    const status = await checkAiProviderStatus(provider);
    if (!status.available || (!status.authenticated && !status.inconclusive)) {
      throw new Error(status.message ?? `${provider.name} is not ready.`);
    }
  } catch (error) {
    if (isAiRunCancelled(error)) throw error;
    if (error instanceof Error && error.message.includes("is not ready")) throw error;
    throw new Error(
      error instanceof Error ? `${provider.name} status check failed: ${error.message}` : `${provider.name} status check failed.`,
    );
  }

  const priorFiling = filings ? findPriorComparableFiling(filings, filing) : null;
  const priorContent = priorFiling && contentCache
    ? contentCache.get(priorFiling.accessionNumber) ?? null
    : null;

  const prompt = buildFilingSummaryPrompt({
    filing,
    content,
    priorContent,
    priorFiling,
  });

  let rawOutput = "";
  try {
    const controller = run({
      providerId: provider.id,
      prompt,
      modelId: provider.defaultModelId ?? undefined,
      outputMode: "plain",
      onChunk: (output) => {
        rawOutput = output;
        onChunk?.(output);
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

  const parsed = parseFilingSummaryResponse(rawOutput);
  const summary: FilingSummary = {
    ...parsed,
    redFlags: detectRedFlags(content),
    generatedAt: Date.now(),
    providerId: provider.id,
    modelId: provider.defaultModelId,
  };

  writeSecSummaryCache(filing.accessionNumber, summary);
  return {
    summary,
    cached: false,
    providerId: provider.id,
    modelId: provider.defaultModelId,
  };
}
