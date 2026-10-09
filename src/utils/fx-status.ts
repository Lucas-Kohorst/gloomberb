import type { QueryEntry } from "../market-data/result-types";
import { unavailableText } from "../components/ui/status-copy";
import { formatObservationAge } from "./datetime-format";

export interface FxRateStatus {
  loading: number;
  unavailable: number;
  stale: number;
  unknownTime: number;
  oldestAsOf: number | null;
  latestFetchedAt: number | null;
}

/** A fetched timestamp never stands in for a source observation timestamp. */
export function summarizeFxRates(
  currencies: readonly string[],
  rates: ReadonlyMap<string, number>,
  read: (currency: string) => QueryEntry<number> | null | undefined,
  now = Date.now(),
): FxRateStatus {
  const status: FxRateStatus = { loading: 0, unavailable: 0, stale: 0, unknownTime: 0, oldestAsOf: null, latestFetchedAt: null };
  for (const currency of new Set(currencies.map((value) => value.trim().toUpperCase()))) {
    if (currency === "USD") continue;
    const entry = read(currency);
    if (entry?.phase === "loading" || entry?.phase === "refreshing") status.loading++;
    const rate = rates.get(currency);
    if (rate == null || !Number.isFinite(rate) || rate <= 0) { status.unavailable++; continue; }
    // A legacy persisted numeric rate may be present without a dated query.
    if (!entry || entry.asOf == null || !Number.isFinite(entry.asOf)) status.unknownTime++;
    else status.oldestAsOf = Math.min(status.oldestAsOf ?? Infinity, entry.asOf);
    if (entry?.error || (entry?.staleAt != null && entry.staleAt <= now)) status.stale++;
    if (entry?.fetchedAt != null) status.latestFetchedAt = Math.max(status.latestFetchedAt ?? 0, entry.fetchedAt);
  }
  return status;
}

export function fxStatusLabel(status: FxRateStatus): string {
  const parts: string[] = [];
  if (status.unavailable) parts.push(`${status.unavailable} unavailable`);
  if (status.unknownTime) parts.push(`${status.unknownTime} rate ${status.unknownTime === 1 ? "time" : "times"} unknown`);
  const age = formatObservationAge(status.oldestAsOf);
  if (status.stale) parts.push(age ?? unavailableText("Rates"));
  else if (age) parts.push(age);
  return parts.join(" · ");
}
