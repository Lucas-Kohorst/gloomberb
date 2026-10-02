import type { AdjacentClient } from "./client";
import { ADJACENT_DEFAULT_PRICE_RANGE, adjacentPriceTier, adjacentPriceWindow } from "./price-window";

export interface AdjacentIndexSubject {
  kind: "index";
  id: string;
}

/** `prefetch` runs when an index row is selected, before its detail tab opens. */
export interface AdjacentDetailPreload {
  id: string;
  prefetch(client: AdjacentClient, subject: AdjacentIndexSubject): Promise<void> | void;
}

const registry: AdjacentDetailPreload[] = [];

export function registerAdjacentDetailPreload(entry: AdjacentDetailPreload): () => void {
  const without = registry.filter((item) => item.id !== entry.id);
  registry.splice(0, registry.length, ...without, entry);
  return () => {
    const at = registry.findIndex((item) => item.id === entry.id && item.prefetch === entry.prefetch);
    if (at >= 0) registry.splice(at, 1);
  };
}

export function prefetchAdjacentIndexDetail(client: AdjacentClient, id: string): void {
  const subject: AdjacentIndexSubject = { kind: "index", id };
  for (const entry of [...registry]) {
    try {
      void Promise.resolve(entry.prefetch(client, subject)).catch(() => undefined);
    } catch {
      // A preload must not break row selection.
    }
  }
}

function installBuiltinPreloads(): void {
  registerAdjacentDetailPreload({
    id: "adjacent-index-constituents",
    prefetch(client, subject) {
      void client.getIndexConstituents(subject.id).catch(() => undefined);
      void client.getIndex(subject.id).catch(() => undefined);
    },
  });
  registerAdjacentDetailPreload({
    id: "adjacent-index-news",
    prefetch(client, subject) {
      void client.getIndexNews(subject.id).catch(() => undefined);
    },
  });
  registerAdjacentDetailPreload({
    id: "adjacent-index-filings",
    prefetch(client, subject) {
      if (client.isPublic) return;
      void client.getIndexFilings(subject.id).catch(() => undefined);
    },
  });
  registerAdjacentDetailPreload({
    id: "adjacent-index-prices",
    prefetch(client, subject) {
      const window = adjacentPriceWindow(ADJACENT_DEFAULT_PRICE_RANGE, adjacentPriceTier(client));
      void client.getIndexPrices(subject.id, window).catch(() => undefined);
    },
  });
}

installBuiltinPreloads();
