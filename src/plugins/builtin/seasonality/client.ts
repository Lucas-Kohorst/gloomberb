import { getSharedMarketDataCoordinator, MarketDataCoordinator, resolveEntryValue } from "../../../market-data/coordinator";
import type { InstrumentRef } from "../../../market-data/request-types";
import type { DataProvider } from "../../../types/data-provider";
import type { PricePoint } from "../../../types/financials";

export interface SeasonalityHistory {
  history: PricePoint[];
  stale: boolean;
  error: string | null;
  fetchedAt: number;
}

const CANCELLED = "Seasonality history load was cancelled";

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(CANCELLED);
}

/** loadChart does not take a signal, so cancellation only drops the result. */
async function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(CANCELLED));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every month on record: the lookback is cut in the model, so changing it never
 * refetches. Monthly bars, because daily history is only served to 5Y where
 * provider support is not known yet, and a longer daily request comes back as
 * Monday-stamped weeks that file a week's close under the wrong month.
 */
export async function loadSeasonalityHistory(
  request: { instrument: InstrumentRef; signal?: AbortSignal; forceRefresh?: boolean },
  marketData?: DataProvider,
): Promise<SeasonalityHistory> {
  throwIfAborted(request.signal);
  const now = Date.now();
  const coordinator = marketData ? new MarketDataCoordinator(marketData) : getSharedMarketDataCoordinator();
  try {
    if (!coordinator) throw new Error("Market data coordinator unavailable");
    const entry = await abortable(coordinator.loadChart({
      instrument: request.instrument,
      bufferRange: "ALL",
      granularity: "resolution",
      resolution: "1mo",
    }, { forceRefresh: request.forceRefresh }), request.signal);
    const history = resolveEntryValue(entry) ?? [];
    return {
      history,
      stale: !!entry.error || (entry.staleAt != null && entry.staleAt <= now),
      error: entry.error?.message ?? (history.length ? null : "No monthly price history available"),
      fetchedAt: entry.fetchedAt ?? now,
    };
  } catch (error) {
    if (request.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw abortError(CANCELLED);
    return { history: [], stale: false, error: errorMessage(error), fetchedAt: now };
  }
}
