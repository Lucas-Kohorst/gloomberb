import { useEffect, useState } from "react";
import { fetchOwidChartMetadata, fetchOwidChartSearch } from "../owid/client";
import { OwidUpstreamError } from "../../../sources/owid/types";
import type { OwidChartMetadataPrint } from "../../../sources/owid/types";
import {
  catalogOwidDiscoveryQuery,
  catalogRowsFromOwidHits,
  type CatalogSeriesRow,
} from "./catalog-inventory";

const PROBE_CONCURRENCY = 4;
const QUERY_CACHE_LIMIT = 8;

const catalogOwidRowsCache = new Map<string, CatalogSeriesRow[]>();
const catalogOwidRowsInflight = new Map<string, Promise<CatalogSeriesRow[]>>();
const catalogOwidMetadataCache = new Map<string, OwidChartMetadataPrint | "blocked">();

export function resetCatalogOwidCaches(): void {
  catalogOwidRowsCache.clear();
  catalogOwidRowsInflight.clear();
  catalogOwidMetadataCache.clear();
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]!);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

function rememberQueryRows(query: string, rows: CatalogSeriesRow[]): void {
  if (catalogOwidRowsCache.has(query)) catalogOwidRowsCache.delete(query);
  catalogOwidRowsCache.set(query, rows);
  while (catalogOwidRowsCache.size > QUERY_CACHE_LIMIT) {
    const oldest = catalogOwidRowsCache.keys().next().value;
    if (oldest === undefined) break;
    catalogOwidRowsCache.delete(oldest);
  }
}

async function probeOwidMetadata(slug: string): Promise<OwidChartMetadataPrint | null> {
  const cached = catalogOwidMetadataCache.get(slug);
  if (cached === "blocked") return null;
  if (cached) return cached;
  try {
    const metadata = await fetchOwidChartMetadata(slug);
    catalogOwidMetadataCache.set(slug, metadata);
    return metadata;
  } catch (error) {
    if (isOwidNonRedistributableError(error)) catalogOwidMetadataCache.set(slug, "blocked");
    return null;
  }
}

export function isOwidNonRedistributableError(error: unknown): boolean {
  const status = error instanceof OwidUpstreamError
    ? error.status
    : (error as { status?: number } | null)?.status;
  return status === 403;
}

export async function loadCatalogOwidRows(query: string): Promise<CatalogSeriesRow[]> {
  const discovery = catalogOwidDiscoveryQuery(query);
  if (discovery == null) return [];
  const cached = catalogOwidRowsCache.get(discovery);
  if (cached) return cached;
  const inflight = catalogOwidRowsInflight.get(discovery);
  if (inflight) return inflight;

  const pending = (async () => {
    const search = await fetchOwidChartSearch(discovery).catch(() => null);
    if (!search) return [] as CatalogSeriesRow[];
    const metadataBySlug = new Map<string, OwidChartMetadataPrint>();
    await mapPool(search.results, PROBE_CONCURRENCY, async (hit) => {
      const metadata = await probeOwidMetadata(hit.slug);
      if (metadata) metadataBySlug.set(hit.slug, metadata);
    });
    const rows = catalogRowsFromOwidHits(search.results, metadataBySlug);
    rememberQueryRows(discovery, rows);
    return rows;
  })().finally(() => {
    catalogOwidRowsInflight.delete(discovery);
  });

  catalogOwidRowsInflight.set(discovery, pending);
  return pending;
}

export function useCatalogOwidRows(
  searchQuery: string,
  refreshNonce = 0,
): { rows: CatalogSeriesRow[]; loading: boolean } {
  const discovery = catalogOwidDiscoveryQuery(searchQuery);
  const [rows, setRows] = useState<CatalogSeriesRow[]>(
    discovery != null ? catalogOwidRowsCache.get(discovery) ?? [] : [],
  );
  const [loading, setLoading] = useState(discovery != null && !catalogOwidRowsCache.has(discovery));

  useEffect(() => {
    if (discovery == null) {
      setRows([]);
      setLoading(false);
      return;
    }
    const cached = catalogOwidRowsCache.get(discovery);
    if (cached) {
      setRows(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      void loadCatalogOwidRows(searchQuery).then((next) => {
        if (cancelled) return;
        setRows(next);
        setLoading(false);
      }).catch(() => {
        if (!cancelled) setLoading(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [discovery, refreshNonce, searchQuery]);

  return { rows, loading };
}
