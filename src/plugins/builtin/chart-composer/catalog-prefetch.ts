import { useEffect, useState } from "react";
import { fetchArtificialAnalysisData } from "../llm-stats/client";
import { fetchVoteHubPolls } from "../polls/client";
import { getSharedAdjacentClient } from "../adjacent/client";
import {
  VOTEHUB_POLL_TYPES,
  catalogPollSubjectsFromPolls,
  catalogRowsFromAaModels,
  catalogRowsFromPollSubjects,
  type CatalogSeriesRow,
} from "./catalog-inventory";
import { loadCatalogPredictionHits } from "./use-series-catalog";

export type CatalogAdjacentIndex = {
  indexId: string;
  name: string;
  ticker?: string;
};

let catalogAaRowsCache: CatalogSeriesRow[] | null = null;
let catalogAaRowsInflight: Promise<CatalogSeriesRow[]> | null = null;
let catalogPollRowsCache: CatalogSeriesRow[] | null = null;
let catalogPollRowsInflight: Promise<CatalogSeriesRow[]> | null = null;
let catalogAdjacentIndicesCache: CatalogAdjacentIndex[] | null = null;
let catalogAdjacentIndicesInflight: Promise<CatalogAdjacentIndex[]> | null = null;
let catalogWarmScheduled = false;

export function peekCatalogAaRows(): CatalogSeriesRow[] | null {
  return catalogAaRowsCache;
}

export function peekCatalogPollRows(): CatalogSeriesRow[] | null {
  return catalogPollRowsCache;
}

export function peekCatalogAdjacentIndices(): CatalogAdjacentIndex[] | null {
  return catalogAdjacentIndicesCache;
}

export function resetCatalogPrefetchCaches(): void {
  catalogAaRowsCache = null;
  catalogAaRowsInflight = null;
  catalogPollRowsCache = null;
  catalogPollRowsInflight = null;
  catalogAdjacentIndicesCache = null;
  catalogAdjacentIndicesInflight = null;
  catalogWarmScheduled = false;
}

export function loadCatalogAaRows(): Promise<CatalogSeriesRow[]> {
  if (catalogAaRowsCache) return Promise.resolve(catalogAaRowsCache);
  if (catalogAaRowsInflight) return catalogAaRowsInflight;
  catalogAaRowsInflight = fetchArtificialAnalysisData()
    .then((data) => catalogRowsFromAaModels(data.rows))
    .catch(() => [] as CatalogSeriesRow[])
    .then((rows) => {
      if (rows.length > 0) catalogAaRowsCache = rows;
      return rows;
    })
    .finally(() => {
      catalogAaRowsInflight = null;
    });
  return catalogAaRowsInflight;
}

export function loadCatalogPollRows(): Promise<CatalogSeriesRow[]> {
  if (catalogPollRowsCache) return Promise.resolve(catalogPollRowsCache);
  if (catalogPollRowsInflight) return catalogPollRowsInflight;
  catalogPollRowsInflight = Promise.all(
    VOTEHUB_POLL_TYPES.map((pollType) => fetchVoteHubPolls({ pollType }).catch(() => [])),
  ).then((batches) => {
    const rows = catalogRowsFromPollSubjects(catalogPollSubjectsFromPolls(batches.flat()));
    if (rows.length > 0) catalogPollRowsCache = rows;
    return rows;
  }).finally(() => {
    catalogPollRowsInflight = null;
  });
  return catalogPollRowsInflight;
}

function mapAdjacentIndices(
  response: { data?: Array<{ index_id?: string; name: string; ticker?: string }> },
): CatalogAdjacentIndex[] {
  return (response.data ?? []).flatMap((index) => {
    const indexId = index.index_id?.trim();
    if (!indexId) return [];
    return [{
      indexId,
      name: index.name,
      ...(index.ticker ? { ticker: index.ticker } : {}),
    }];
  });
}

export function loadCatalogAdjacentIndices(): Promise<CatalogAdjacentIndex[]> {
  if (catalogAdjacentIndicesCache) return Promise.resolve(catalogAdjacentIndicesCache);
  if (catalogAdjacentIndicesInflight) return catalogAdjacentIndicesInflight;
  catalogAdjacentIndicesInflight = getSharedAdjacentClient().getIndices()
    .then(mapAdjacentIndices)
    .catch(() => [] as CatalogAdjacentIndex[])
    .then((indices) => {
      if (indices.length > 0) catalogAdjacentIndicesCache = indices;
      return indices;
    })
    .finally(() => {
      catalogAdjacentIndicesInflight = null;
    });
  return catalogAdjacentIndicesInflight;
}

export function warmDataCatalogSources(): Promise<void> {
  return Promise.allSettled([
    loadCatalogPredictionHits(),
    loadCatalogAaRows(),
    loadCatalogPollRows(),
    loadCatalogAdjacentIndices(),
  ]).then(() => undefined);
}

export function scheduleDataCatalogWarm(): void {
  if (catalogWarmScheduled) return;
  catalogWarmScheduled = true;
  const run = () => {
    void warmDataCatalogSources();
  };
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === "function") {
    idle(run, { timeout: 2500 });
    return;
  }
  setTimeout(run, 0);
}

export function useCatalogAaRows(refreshNonce = 0): { rows: CatalogSeriesRow[]; loading: boolean } {
  const [rows, setRows] = useState<CatalogSeriesRow[]>(catalogAaRowsCache ?? []);
  const [loading, setLoading] = useState(catalogAaRowsCache == null);

  useEffect(() => {
    if (catalogAaRowsCache) {
      setRows(catalogAaRowsCache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadCatalogAaRows().then((next) => {
      if (cancelled) return;
      setRows(next);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  return { rows, loading };
}

export function useCatalogPollRows(refreshNonce = 0): { rows: CatalogSeriesRow[]; loading: boolean } {
  const [rows, setRows] = useState<CatalogSeriesRow[]>(catalogPollRowsCache ?? []);
  const [loading, setLoading] = useState(catalogPollRowsCache == null);

  useEffect(() => {
    if (catalogPollRowsCache) {
      setRows(catalogPollRowsCache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadCatalogPollRows().then((next) => {
      if (cancelled) return;
      setRows(next);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  return { rows, loading };
}

export function useCatalogAdjacentIndices(refreshNonce = 0): {
  indices: CatalogAdjacentIndex[];
  loading: boolean;
} {
  const [indices, setIndices] = useState<CatalogAdjacentIndex[]>(catalogAdjacentIndicesCache ?? []);
  const [loading, setLoading] = useState(catalogAdjacentIndicesCache == null);

  useEffect(() => {
    if (catalogAdjacentIndicesCache) {
      setIndices(catalogAdjacentIndicesCache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadCatalogAdjacentIndices().then((next) => {
      if (cancelled) return;
      setIndices(next);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  return { indices, loading };
}
