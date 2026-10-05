import { describe, expect, test } from "bun:test";
import { adjacentIndexTickerRecord, adjacentMarketTickerRecord } from "../register-watchlist-asset";
import { resolveWatchlistRowOpen } from "./open-target";

describe("resolveWatchlistRowOpen", () => {
  test("Adjacent index watchlist rows open ADI, not DES", () => {
    const ticker = adjacentIndexTickerRecord({ index_id: "red", ticker: "RED", name: "RED Index" });
    expect(resolveWatchlistRowOpen(ticker)).toEqual({ templateId: "adjacent-indices-pane", arg: "RED" });
  });

  test("Adjacent market watchlist rows open Prediction Markets", () => {
    const ticker = adjacentMarketTickerRecord({ id: "m1", ticker: "FED", title: "Fed cuts", platform: "kalshi" });
    expect(resolveWatchlistRowOpen(ticker)).toEqual({ templateId: "new-prediction-markets-pane", arg: "Fed cuts" });
  });
});