import type { PluginPersistence } from "../../../types/plugin";
import type { FilingSummary } from "./summary-contract";

const CACHE_KIND = "sec-filing-summary";
const CACHE_SOURCE = "sec-ai-summary";
/**
 * Schema bumps invalidate prior cache entries on structure changes.
 */
const CACHE_SCHEMA_VERSION = 1;
/**
 * Summaries are derived from filing text that never changes once filed, so a
 * long freshness window is appropriate. Stale entries are still served until
 * they expire; a forced refresh bypasses the cache.
 */
const CACHE_POLICY = {
  staleMs: 7 * 24 * 60 * 60 * 1000,
  expireMs: 30 * 24 * 60 * 60 * 1000,
} as const;

let persistence: PluginPersistence | null = null;

export function attachSecSummaryPersistence(next: PluginPersistence): void {
  persistence = next;
}

export function resetSecSummaryPersistence(): void {
  persistence = null;
}

function cacheKey(accessionNumber: string): string {
  return accessionNumber;
}

export interface SecSummaryCacheRecord {
  summary: FilingSummary;
  fetchedAt: number;
  stale: boolean;
}

export function readSecSummaryCache(
  accessionNumber: string,
  options?: { allowExpired?: boolean },
): SecSummaryCacheRecord | null {
  const record = persistence?.getResource<FilingSummary>(
    CACHE_KIND,
    cacheKey(accessionNumber),
    {
      sourceKey: CACHE_SOURCE,
      schemaVersion: CACHE_SCHEMA_VERSION,
      allowExpired: options?.allowExpired,
    },
  );
  if (!record || !record.value) return null;
  return { summary: record.value, fetchedAt: record.fetchedAt, stale: !!record.stale };
}

export function writeSecSummaryCache(accessionNumber: string, summary: FilingSummary): void {
  persistence?.setResource(CACHE_KIND, cacheKey(accessionNumber), summary, {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    cachePolicy: CACHE_POLICY,
  });
}

export function deleteSecSummaryCache(accessionNumber: string): void {
  persistence?.deleteResource(CACHE_KIND, cacheKey(accessionNumber), {
    sourceKey: CACHE_SOURCE,
  });
}
