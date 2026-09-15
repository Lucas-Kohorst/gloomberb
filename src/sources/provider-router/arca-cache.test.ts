import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetDataRouter } from "./index";
import { AppPersistence } from "../../data/app-persistence";
import type { DataProvider } from "../../types/data-provider";
import type { Quote, TickerFinancials } from "../../types/financials";
import { fallbackProvider } from "./test-support";

function financials(exchange: string, price: number): TickerFinancials {
  const quote: Quote = {
    symbol: "TIP",
    listingExchangeName: exchange,
    exchangeName: exchange,
    currency: "USD",
    price,
    change: 0,
    changePercent: 0,
    lastUpdated: Date.now(),
    marketState: "CLOSED",
  };
  return {
    quote,
    annualStatements: exchange === "ARCA" ? [] : [{ date: "2025-12-31", currency: "USD", totalRevenue: 666 }],
    quarterlyStatements: [],
    priceHistory: [],
  };
}

test("legacy PCX normalization cannot outrank a fresh Arca listing or survive a cache restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gloom-arca-cache-"));
  const path = join(dir, "cache.sqlite");
  let store = new AppPersistence(path);
  const old = financials("AMEX", 666);
  const fresh = financials("ARCA", 105);
  let requests = 0;
  const provider: DataProvider = {
    ...fallbackProvider,
    id: "test-provider",
    async getTickerFinancials() { requests++; return fresh; },
  };
  try {
    for (const variantKey of ["", "exchange=AMEX"]) {
      store.resources.set(
        { namespace: "market", kind: "financials", entityKey: "TIP", variantKey, sourceKey: "provider:test-provider" },
        old,
        { cachePolicy: { staleMs: 60_000, expireMs: 600_000 } },
      );
      store.resources.set(
        { namespace: "market", kind: "quote", entityKey: "TIP", variantKey, sourceKey: "provider:test-provider" },
        old.quote,
        { cachePolicy: { staleMs: 60_000, expireMs: 600_000 } },
      );
    }
    store.close(); store = new AppPersistence(path);
    const router = new AssetDataRouter(provider, [], store.resources);
    for (const exchange of ["PCX", "ARCA"] as const) {
      expect(router.getCachedFinancialsForTargets([{ symbol: "TIP", exchange }]).get("TIP")?.quote?.price).not.toBe(666);
      const result = await router.getTickerFinancials("TIP", exchange);
      expect(result.quote).toMatchObject({ price: 105, listingExchangeName: "ARCA" });
      expect(result.annualStatements).toEqual([]);
    }
    expect(router.getCachedFinancialsForTargets([{ symbol: "TIP", exchange: "AMEX" }]).get("TIP")?.quote?.price).toBe(666);
    const count = requests;
    store.close(); store = new AppPersistence(path);
    const reopened = new AssetDataRouter(provider, [], store.resources);
    expect(reopened.getCachedFinancialsForTargets([{ symbol: "TIP", exchange: "PCX" }]).get("TIP")?.quote?.price).toBe(105);
    expect(reopened.getCachedFinancialsForTargets([{ symbol: "TIP", exchange: "ARCA" }]).get("TIP")?.quote?.price).toBe(105);
    expect(requests).toBe(count);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
