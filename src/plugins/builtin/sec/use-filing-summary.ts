import { useCallback, useEffect, useRef, useState } from "react";
import type { SecFilingItem } from "../../../types/data-provider";
import { useAiRuntimeProviders } from "../ai/use-runtime-providers";
import type { FilingSummary } from "./summary-contract";
import { isAiRunCancelled, summarizeFiling, type SummaryAiRunner } from "./summary-runner";

export interface UseFilingSummaryOptions {
  /** Override the AI runner for tests; defaults to the shared runtime. */
  run?: SummaryAiRunner;
  /** All filings of the same form, used to find the prior comparable filing. */
  filings?: readonly SecFilingItem[];
  /** Cached content for prior filings, keyed by accession number. */
  contentCache?: ReadonlyMap<string, string | null>;
}

export interface UseFilingSummaryResult {
  summaries: Map<string, FilingSummary>;
  summarizingAccession: string | null;
  summaryError: string | null;
  summarize: (filing: SecFilingItem, content: string, force?: boolean) => Promise<void>;
  clearSummaryError: () => void;
}

export function useFilingSummary(options: UseFilingSummaryOptions = {}): UseFilingSummaryResult {
  const providers = useAiRuntimeProviders();
  const [summaries, setSummaries] = useState<Map<string, FilingSummary>>(new Map());
  const [summarizingAccession, setSummarizingAccession] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const inflightRef = useRef<AbortController | null>(null);
  const runRef = useRef(options.run);
  runRef.current = options.run;

  useEffect(() => () => {
    inflightRef.current?.abort();
  }, []);

  const summarize = useCallback(async (
    filing: SecFilingItem,
    content: string,
    force = false,
  ) => {
    if (summarizingAccession) return;
    setSummaryError(null);
    setSummarizingAccession(filing.accessionNumber);
    const controller = new AbortController();
    inflightRef.current?.abort();
    inflightRef.current = controller;

    try {
      const result = await summarizeFiling({
        filing,
        content,
        filings: options.filings,
        contentCache: options.contentCache,
        providers,
        run: runRef.current,
        force,
      });
      if (controller.signal.aborted) return;
      setSummaries((current) => new Map(current).set(filing.accessionNumber, result.summary));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isAiRunCancelled(error)) return;
      setSummaryError(error instanceof Error ? error.message : "Failed to summarize filing.");
    } finally {
      if (inflightRef.current === controller) inflightRef.current = null;
      if (!controller.signal.aborted) setSummarizingAccession(null);
    }
  }, [options.contentCache, options.filings, providers, summarizingAccession]);

  const clearSummaryError = useCallback(() => setSummaryError(null), []);

  return { summaries, summarizingAccession, summaryError, summarize, clearSummaryError };
}
