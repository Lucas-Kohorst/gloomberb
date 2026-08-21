import { useEffect, useState } from "react";
import { catalogOwidDiscoveryQuery, type CatalogSeriesRow } from "./catalog-inventory";
import {
  loadCatalogOwidRows,
  OWID_SNAPSHOT_QUERY,
  peekCatalogOwidRows,
} from "./catalog-owid";

function mergeOwidRows(...batches: readonly (readonly CatalogSeriesRow[])[]): CatalogSeriesRow[] {
  const merged = new Map<string, CatalogSeriesRow>();
  for (const batch of batches) {
    for (const entry of batch) {
      if (!merged.has(entry.id)) merged.set(entry.id, entry);
    }
  }
  return [...merged.values()];
}

export function useCatalogOwidRows(
  searchQuery: string,
  refreshNonce = 0,
): { rows: CatalogSeriesRow[]; loading: boolean } {
  const discovery = catalogOwidDiscoveryQuery(searchQuery);
  const snapshot = peekCatalogOwidRows(OWID_SNAPSHOT_QUERY) ?? [];
  const [rows, setRows] = useState<CatalogSeriesRow[]>(
    discovery == null
      ? []
      : mergeOwidRows(peekCatalogOwidRows(discovery) ?? [], snapshot),
  );
  const [loading, setLoading] = useState(
    discovery != null && peekCatalogOwidRows(discovery === OWID_SNAPSHOT_QUERY ? OWID_SNAPSHOT_QUERY : discovery) == null,
  );

  useEffect(() => {
    let cancelled = false;
    const snapshotCached = peekCatalogOwidRows(OWID_SNAPSHOT_QUERY);
    if (!snapshotCached) {
      setLoading(true);
      void loadCatalogOwidRows(OWID_SNAPSHOT_QUERY).then((next) => {
        if (cancelled) return;
        setRows((current) => mergeOwidRows(current, next));
        if (discovery == null || discovery === OWID_SNAPSHOT_QUERY) setLoading(false);
      }).catch(() => {
        if (!cancelled && (discovery == null || discovery === OWID_SNAPSHOT_QUERY)) setLoading(false);
      });
    }

    if (discovery == null) {
      setRows([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    if (discovery === OWID_SNAPSHOT_QUERY) {
      if (snapshotCached) {
        setRows(snapshotCached);
        setLoading(false);
      }
      return () => {
        cancelled = true;
      };
    }

    const cached = peekCatalogOwidRows(discovery);
    if (cached) {
      setRows(mergeOwidRows(cached, snapshotCached ?? []));
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const timer = setTimeout(() => {
      setLoading(true);
      void loadCatalogOwidRows(searchQuery).then((next) => {
        if (cancelled) return;
        setRows(mergeOwidRows(next, peekCatalogOwidRows(OWID_SNAPSHOT_QUERY) ?? []));
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
