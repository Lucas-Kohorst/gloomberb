import { describe, expect, test } from "bun:test";
import { MemoryPersistence } from "../../test-helpers";
import {
  attachPredictionMarketsPersistence,
  resetPredictionMarketsPersistence,
} from "../fetch";
import {
  buildHostedAdjacentKalshiMarketsUrl,
  fetchHostedAdjacentKalshiCatalogPage,
  kalshiEventTickerFromAdjacent,
  kalshiTickerFromAdjacentId,
  mapAdjacentKalshiCatalog,
  mapAdjacentKalshiMarket,
  resetHostedAdjacentPathFallback,
} from "./adjacent-catalog";

const NBA_SPURS = {
  category: "Sports",
  display_ticker: "KXNBA-26-SAS",
  end_date: "2028-06-29T14:00:00Z",
  link: "https://kalshi.com/markets/kxnba/kxnba-26",
  market_id: "kalshi:KXNBA-26-SAS",
  open_interest: 21126222,
  platform: "kalshi" as const,
  probability: 65,
  question: "Will the San Antonio win the 2026 Pro Basketball Finals?",
  status: "active",
  ticker: "KXNBA-26-SAS",
  volume: 44319320,
  volume_24h: 1092341.9,
};

describe("adjacent Kalshi catalog mapping", () => {
  test("strips kalshi: from market_id and scales probability 0-100 to yesPrice 0-1", () => {
    const mapped = mapAdjacentKalshiMarket(NBA_SPURS);

    expect(mapped?.venue).toBe("kalshi");
    expect(mapped?.marketId).toBe("KXNBA-26-SAS");
    expect(mapped?.key).toBe("kalshi:KXNBA-26-SAS");
    expect(mapped?.yesPrice).toBe(0.65);
    expect(mapped?.noPrice).toBeCloseTo(0.35);
    expect(mapped?.status).toBe("open");
    expect(mapped?.endsAt).toBe("2028-06-29T14:00:00Z");
    expect(mapped?.volume24h).toBe(1092341.9);
    expect(mapped?.openInterest).toBe(21126222);
    expect(mapped?.eventTicker).toBe("KXNBA-26");
    expect(mapped?.marketLabel).toBe("SAS");
  });

  test("treats missing volume as null rather than NaN", () => {
    const mapped = mapAdjacentKalshiMarket({
      market_id: "kalshi:KXNBA-26-NYK",
      platform: "kalshi",
      probability: 37,
      question: "Will the New York win the 2026 Pro Basketball Finals?",
      status: "active",
    });

    expect(mapped?.yesPrice).toBe(0.37);
    expect(mapped?.volume24h).toBeNull();
    expect(mapped?.totalVolume).toBeNull();
    expect(mapped?.openInterest).toBeNull();
    expect(Number.isNaN(mapped?.volume24h)).toBe(false);
  });

  test("ignores non-Kalshi Adjacent rows", () => {
    expect(
      mapAdjacentKalshiMarket({
        market_id: "polymarket:0xabc",
        platform: "polymarket",
        probability: 50,
        question: "Will it rain?",
      }),
    ).toBeNull();
  });

  test("prefers event_id when Adjacent includes a parent event", () => {
    expect(
      kalshiEventTickerFromAdjacent(
        { event_id: "kalshi:KXNEXTTEAMNBA-26LJAM" },
        "KXNEXTTEAMNBA-26LJAM-PHI",
      ),
    ).toBe("KXNEXTTEAMNBA-26LJAM");
  });

  test("does not invent an event ticker for a single-hyphen market", () => {
    expect(kalshiTickerFromAdjacentId("kalshi:KAL-1")).toBe("KAL-1");
    expect(kalshiEventTickerFromAdjacent({}, "KAL-1")).toBeUndefined();
  });

  test("keeps sibling outcome contracts grouped under one event", () => {
    const rows = mapAdjacentKalshiCatalog(
      [
        NBA_SPURS,
        {
          ...NBA_SPURS,
          market_id: "kalshi:KXNBA-26-NYK",
          ticker: "KXNBA-26-NYK",
          display_ticker: "KXNBA-26-NYK",
          probability: 37,
          question: "Will the New York win the 2026 Pro Basketball Finals?",
          volume_24h: 1873462,
        },
      ],
      "all",
      "top",
    );

    expect(rows.map((row) => row.eventTicker)).toEqual(["KXNBA-26", "KXNBA-26"]);
    expect(rows[0]?.marketId).toBe("KXNBA-26-NYK");
  });
});

describe("hosted Adjacent Kalshi catalog URL", () => {
  test("uses auth /markets with search/per_page, never /public or q/limit", () => {
    const url = buildHostedAdjacentKalshiMarketsUrl({
      searchQuery: "nba",
      page: 1,
    });

    expect(url).toContain("/api/data/adjacent/markets");
    expect(url).toContain("platform=kalshi");
    expect(url).toContain("scope=all");
    expect(url).toContain("per_page=50");
    expect(url).toContain("search=nba");
    expect(url).not.toContain("/public");
    expect(url).not.toContain("q=nba");
    expect(url.includes("limit=")).toBe(false);
  });

  // A content blocker kills `/api/data/adjacent/*` before it leaves Chrome, so
  // retrying the same path can only ever fail again.
  test("switches to the blocker-safe route for the session once blocked", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());
    resetHostedAdjacentPathFallback();
    const requested: string[] = [];
    const realFetch = globalThis.fetch;
    const realLocation = globalThis.location;
    // Blocked-request detection is same-origin only, so the hosted origin has
    // to be present for this to exercise anything.
    Object.defineProperty(globalThis, "location", {
      value: { origin: "https://terminal.kohor.st" },
      configurable: true,
      writable: true,
    });
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/api/data/adjacent")) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ data: [NBA_SPURS] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const first = await fetchHostedAdjacentKalshiCatalogPage({ page: 1 });
      expect(first.markets[0]?.marketId).toBe("KXNBA-26-SAS");
      expect(requested.at(-1)).toContain("/api/feed/mkt/markets");

      requested.length = 0;
      await fetchHostedAdjacentKalshiCatalogPage({ page: 2 });
      expect(requested.every((url) => url.includes("/api/feed/mkt/"))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      Object.defineProperty(globalThis, "location", {
        value: realLocation,
        configurable: true,
        writable: true,
      });
      resetHostedAdjacentPathFallback();
      resetPredictionMarketsPersistence();
    }
  });
});
