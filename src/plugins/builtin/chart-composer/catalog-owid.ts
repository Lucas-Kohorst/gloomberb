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
const OWID_METADATA_PROBE_LIMIT = 16;
export const OWID_SNAPSHOT_QUERY = "";

const catalogOwidRowsCache = new Map<string, CatalogSeriesRow[]>();
const catalogOwidRowsInflight = new Map<string, Promise<CatalogSeriesRow[]>>();
const catalogOwidMetadataCache = new Map<string, OwidChartMetadataPrint | "blocked">();

export function resetCatalogOwidCaches(): void {
  catalogOwidRowsCache.clear();
  catalogOwidRowsInflight.clear();
  catalogOwidMetadataCache.clear();
}

export function peekCatalogOwidRows(query = OWID_SNAPSHOT_QUERY): CatalogSeriesRow[] | null {
  return catalogOwidRowsCache.get(catalogOwidDiscoveryQuery(query) ?? OWID_SNAPSHOT_QUERY) ?? null;
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
    if (!search) {
      rememberQueryRows(discovery, []);
      return [] as CatalogSeriesRow[];
    }
    const metadataBySlug = new Map<string, OwidChartMetadataPrint>();
    const blockedSlugs = new Set<string>();
    const hits = search.results.slice(0, OWID_METADATA_PROBE_LIMIT);
    await mapPool(hits, PROBE_CONCURRENCY, async (hit) => {
      const metadata = await probeOwidMetadata(hit.slug);
      if (metadata) {
        metadataBySlug.set(hit.slug, metadata);
        return;
      }
      if (catalogOwidMetadataCache.get(hit.slug) === "blocked") blockedSlugs.add(hit.slug);
    });
    const rows = catalogRowsFromOwidHits(hits, metadataBySlug, blockedSlugs);
    rememberQueryRows(discovery, rows);
    return rows;
  })().finally(() => {
    catalogOwidRowsInflight.delete(discovery);
  });

  catalogOwidRowsInflight.set(discovery, pending);
  return pending;
}
