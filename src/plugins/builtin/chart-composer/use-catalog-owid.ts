import { useEffect, useState } from "react";
import { catalogOwidDiscoveryQuery, type CatalogSeriesRow } from "./catalog-inventory";
import {
  loadCatalogOwidRows,
  peekCatalogOwidRows,
} from "./catalog-owid";

export function useCatalogOwidRows(
  searchQuery: string,
  refreshNonce = 0,
): { rows: CatalogSeriesRow[]; loading: boolean } {
  const discovery = catalogOwidDiscoveryQuery(searchQuery);
  const [rows, setRows] = useState<CatalogSeriesRow[]>(
    discovery == null ? [] : peekCatalogOwidRows(discovery) ?? [],
  );
  const [loading, setLoading] = useState(
    discovery != null && peekCatalogOwidRows(discovery) == null,
  );

  useEffect(() => {
    if (discovery == null) {
      setRows([]);
      setLoading(false);
      return;
    }

    const cached = peekCatalogOwidRows(discovery);
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
    }, discovery === "" ? 0 : 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [discovery, refreshNonce, searchQuery]);

  return { rows, loading };
}
