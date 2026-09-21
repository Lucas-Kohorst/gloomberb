import { describe, expect, test } from "bun:test";
import type { TickerRecord } from "../../../types/ticker";
import { addTickerToWatchlist } from "./mutations";
import { adjacentIndexTickerRecord, adjacentMarketTickerRecord, persistWatchlistMembership } from "./register-watchlist-asset";

describe("registerWatchlistAsset", () => {
  test("adjacent index record is list identity, not a PM venue symbol", () => {
    const ticker = adjacentIndexTickerRecord({
      index_id: "ari_nti",
      ticker: "ARINTI",
      name: "NFL Team Index: Arizona",
    });
    expect(ticker.metadata.ticker).toBe("ARINTI");
    expect(ticker.metadata.assetCategory).toBe("ADJACENT_INDEX");
    expect(ticker.metadata.custom.adjacentIndexId).toBe("ari_nti");
    expect(ticker.metadata.exchange).toBe("ADJACENT");
    expect(ticker.metadata.ticker.startsWith("KALSHI:")).toBe(false);
  });

  test("adjacent market record keeps catalog identity without prices", () => {
    const ticker = adjacentMarketTickerRecord({
      id: "kalshi:fed",
      ticker: "FED",
      title: "Fed cuts",
      platform: "kalshi",
    });
    expect(ticker.metadata.assetCategory).toBe("ADJACENT_MARKET");
    expect(ticker.metadata.custom.adjacentMarketId).toBe("kalshi:fed");
    expect(ticker.metadata.custom.yes_price).toBeUndefined();
    expect(ticker.metadata.ticker.startsWith("KALSHI:")).toBe(false);
  });

  test("persistWatchlistMembership no-ops when already a member", async () => {
    const base = adjacentIndexTickerRecord({ index_id: "red", ticker: "RED", name: "RED Index" });
    const member = addTickerToWatchlist(base, "watchlist").ticker;
    const saved: TickerRecord[] = [];
    const result = await persistWatchlistMembership({
      ticker: member,
      watchlistId: "watchlist",
      tickerRepository: { saveTicker: async (ticker) => { saved.push(ticker); } },
      dispatch: () => {},
    });
    expect(result.changed).toBe(false);
    expect(saved).toEqual([]);
  });
});
