import { afterEach, describe, expect, test } from "bun:test";
import { KALSHI_PROXY_PATH } from "../../shared/hosted-api";
import {
  cleanupPredictionTest,
  installPredictionMarketMocks,
  MemoryPersistence,
} from "./test-helpers";
import { colors } from "../../theme/colors";
import { createPredictionColumns } from "./columns";
import { resolvePredictionKeyboardCommand } from "./keyboard";
import {
  buildPredictionListRows,
  flattenPredictionListRows,
  resolvePredictionListActivation,
  togglePredictionGroupExpanded,
} from "./rows";
import {
  filterPredictionMarkets,
  getPredictionColumnValue,
} from "./metrics";
import {
  attachPredictionMarketsPersistence,
  loadCachedPredictionResource,
  PREDICTION_CACHE_POLICIES,
} from "./services/fetch";
import {
  loadKalshiCatalog,
  loadKalshiHistory,
  normalizeKalshiMarket,
} from "./services/kalshi/adapter";
import {
  loadPolymarketCatalog,
  loadPolymarketDetail,
  normalizePolymarketMarket,
} from "./services/polymarket/adapter";

afterEach(async () => {
  await cleanupPredictionTest();
});

describe("prediction markets plugin registration and services", () => {
  test("uses fresh prediction resource cache without refetching", async () => {
    const persistence = new MemoryPersistence();
    attachPredictionMarketsPersistence(persistence);
    const cached = [
      normalizePolymarketMarket({
        id: "pm-cache",
        question: "Will cached data be used?",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.7","0.3"]',
      })!,
    ];
    persistence.setResource("catalog", "fresh", cached, {
      cachePolicy: PREDICTION_CACHE_POLICIES.catalog,
      sourceKey: "remote",
    });
    let fetchCount = 0;

    const result = await loadCachedPredictionResource(
      "catalog",
      "fresh",
      async () => {
        fetchCount += 1;
        return [];
      },
      PREDICTION_CACHE_POLICIES.catalog,
    );

    expect(result).toBe(cached);
    expect(fetchCount).toBe(0);
  });

  test("normalizes venue payloads", () => {
    expect(
      normalizePolymarketMarket({
        id: "pm-1",
        question: "Will inflation fall?",
        conditionId: "cond-1",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.62","0.38"]',
        clobTokenIds: '["yes-1","no-1"]',
        events: [
          {
            id: "event-1",
            title: "US inflation",
            openInterest: 12,
            tags: [{ label: "Macro" }],
          } as any,
        ],
      } as any)?.yesPrice,
    ).toBe(0.62);

    expect(
      normalizeKalshiMarket({
        ticker: "KAL-1",
        title: "Will the Fed cut rates?",
        yes_sub_title: "Yes",
        status: "open",
        market_type: "binary",
        yes_bid_dollars: "0.47",
        yes_ask_dollars: "0.49",
        no_bid_dollars: "0.51",
        no_ask_dollars: "0.53",
        last_price_dollars: "0.48",
        volume_24h_fp: "15000",
        volume_fp: "90000",
        open_interest_fp: "45000",
        notional_value_dollars: "1.0000",
        liquidity_dollars: "250000",
      } as any),
    ).toMatchObject({
      volume24h: 15000,
      volume24hUnit: "usd",
    });
  });

  test("uses Kalshi target subtitles to disambiguate strike ladders", () => {
    const summary = normalizeKalshiMarket(
      {
        ticker: "KXFED-27APR-T0.25",
        title:
          "Will the upper bound of the federal funds target rate be above 0.25%?",
        yes_sub_title: "Above 0.25%",
        event_ticker: "KXFED-27APR",
        status: "open",
        market_type: "binary",
        last_price_dollars: "0.48",
        strike_type: "greater",
        floor_strike: "0.25",
      } as any,
      {
        title: "Federal funds target rate after April 2026 FOMC",
        sub_title: "Upper bound",
        category: "Economics",
        series_ticker: "KXFED",
      },
    );

    expect(summary?.marketLabel).toBe("Above 0.25%");
    expect(summary?.eventLabel).toBe(
      "Federal funds target rate after April 2026 FOMC · Upper bound",
    );
  });

  test("collapses multi-market venue events into grouped list rows", () => {
    const rows = buildPredictionListRows([
      normalizeKalshiMarket(
        {
          ticker: "KXFED-27APR-T4.25",
          title:
            "Will the upper bound of the federal funds target rate be above 4.25%?",
          yes_sub_title: "Above 4.25%",
          event_ticker: "KXFED-27APR",
          status: "open",
          market_type: "binary",
          last_price_dollars: "0.48",
          volume_24h_fp: "15000",
          strike_type: "greater",
          floor_strike: "4.25",
        } as any,
        {
          title: "Federal funds target rate after April 2026 FOMC",
          sub_title: "Upper bound",
          category: "Economics",
          series_ticker: "KXFED",
        },
      )!,
      normalizeKalshiMarket(
        {
          ticker: "KXFED-27APR-T4.50",
          title:
            "Will the upper bound of the federal funds target rate be above 4.50%?",
          yes_sub_title: "Above 4.50%",
          event_ticker: "KXFED-27APR",
          status: "open",
          market_type: "binary",
          last_price_dollars: "0.31",
          volume_24h_fp: "12000",
          strike_type: "greater",
          floor_strike: "4.50",
        } as any,
        {
          title: "Federal funds target rate after April 2026 FOMC",
          sub_title: "Upper bound",
          category: "Economics",
          series_ticker: "KXFED",
        },
      )!,
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("group");
    expect(rows[0]?.focusMarketKey).toBe("kalshi:KXFED-27APR-T4.25");
    expect(rows[0]?.focusYesPrice).toBe(0.48);
    expect(rows[0]?.volume24h).toBe(27000);

    expect(resolvePredictionListActivation(rows[0]!)).toBe("toggle-group");

    const collapsed = flattenPredictionListRows(rows, new Set());
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.kind).toBe("group");
    expect(collapsed[0]?.kind === "group" && collapsed[0].expanded).toBe(false);
    expect(getPredictionColumnValue(
      { id: "market", label: "MARKET", width: 34, align: "left", description: "" },
      collapsed[0]!,
      false,
    ).text).toMatch(/^▸ /);

    const expandedKeys = togglePredictionGroupExpanded(new Set(), rows[0]!.key);
    expect(expandedKeys.has(rows[0]!.key)).toBe(true);
    const expanded = flattenPredictionListRows(rows, expandedKeys);
    expect(expanded.map((row) => row.kind)).toEqual(["group", "market", "market"]);
    expect(expanded[0]?.kind === "group" && expanded[0].expanded).toBe(true);
    expect(expanded[1]?.title).toBe("Above 4.25%");
    expect(expanded[1] && "parentKey" in expanded[1] ? expanded[1].parentKey : null)
      .toBe(rows[0]!.key);
    expect(resolvePredictionListActivation(expanded[1]!)).toBe("open-detail");
    expect(getPredictionColumnValue(
      { id: "market", label: "MARKET", width: 34, align: "left", description: "" },
      expanded[0]!,
      false,
    ).text).toMatch(/^▾ /);

    const collapsedAgain = togglePredictionGroupExpanded(expandedKeys, rows[0]!.key);
    expect(collapsedAgain.has(rows[0]!.key)).toBe(false);

    const tickerColumn = {
      id: "market_id",
      label: "TICKER",
      width: 20,
      align: "left" as const,
      description: "",
    };
    expect(getPredictionColumnValue(tickerColumn, collapsed[0]!, false).text).toBe("-");
    expect(getPredictionColumnValue(tickerColumn, expanded[1]!, false).text).toBe(
      "KXFED-27APR-T4.25",
    );
  });

  test("hides overflow prediction columns as the pane narrows", () => {
    expect(createPredictionColumns(64).map((column) => column.id)).toEqual([
      "watch",
      "market",
      "yes",
      "spread",
    ]);
    expect(createPredictionColumns(80).map((column) => column.id)).toEqual([
      "watch",
      "market",
      "yes",
      "spread",
    ]);
    expect(createPredictionColumns(100).map((column) => column.id)).toEqual([
      "watch",
      "market",
      "market_id",
      "yes",
      "spread",
      "vol_24h",
    ]);
    expect(createPredictionColumns(132).map((column) => column.id)).toEqual([
      "watch",
      "market",
      "market_id",
      "venue",
      "yes",
      "spread",
      "vol_24h",
      "open_interest",
      "ends",
      "status",
    ]);
  });

  test("filters markets with token-AND fuzzy search on the live query", () => {
    const rows = buildPredictionListRows([
      normalizeKalshiMarket({
        ticker: "KAL-FED",
        title: "Will the Fed cut rates?",
        yes_sub_title: "Yes",
        event_ticker: "FED-1",
        status: "open",
        market_type: "binary",
        last_price_dollars: "0.48",
      } as any)!,
      normalizeKalshiMarket({
        ticker: "KAL-BTC",
        title: "Will bitcoin hit 100k?",
        yes_sub_title: "Yes",
        event_ticker: "BTC-1",
        status: "open",
        market_type: "binary",
        last_price_dollars: "0.61",
      } as any)!,
    ]);

    expect(
      filterPredictionMarkets(rows, "top", "all", "all", "fed rates", new Set()).map(
        (row) => row.marketId,
      ),
    ).toEqual(["KAL-FED"]);
    expect(
      filterPredictionMarkets(rows, "top", "all", "all", "BITCON", new Set()).map(
        (row) => row.marketId,
      ),
    ).toEqual(["KAL-BTC"]);
  });

  test("styles YES consistently and uses the lead contract quote on grouped rows", () => {
    const [row] = buildPredictionListRows([
      normalizeKalshiMarket(
        {
          ticker: "KXFED-27APR-T4.25",
          title:
            "Will the upper bound of the federal funds target rate be above 4.25%?",
          yes_sub_title: "Above 4.25%",
          event_ticker: "KXFED-27APR",
          status: "open",
          market_type: "binary",
          last_price_dollars: "0.48",
          volume_24h_fp: "15000",
          strike_type: "greater",
          floor_strike: "4.25",
        } as any,
        {
          title: "Federal funds target rate after April 2026 FOMC",
          sub_title: "Upper bound",
          category: "Economics",
          series_ticker: "KXFED",
        },
      )!,
      normalizeKalshiMarket(
        {
          ticker: "KXFED-27APR-T4.50",
          title:
            "Will the upper bound of the federal funds target rate be above 4.50%?",
          yes_sub_title: "Above 4.50%",
          event_ticker: "KXFED-27APR",
          status: "open",
          market_type: "binary",
          last_price_dollars: "0.31",
          volume_24h_fp: "12000",
          strike_type: "greater",
          floor_strike: "4.50",
        } as any,
        {
          title: "Federal funds target rate after April 2026 FOMC",
          sub_title: "Upper bound",
          category: "Economics",
          series_ticker: "KXFED",
        },
      )!,
    ]);

    expect(
      getPredictionColumnValue(
        {
          id: "yes",
          label: "TOP ODDS",
          width: 20,
          align: "left",
          description: "",
        },
        row!,
        false,
      ),
    ).toMatchObject({
      text: "48% Above 4.25%",
      color: colors.negative,
    });
  });

  test("uses an allowed Kalshi candlestick interval for 1W history", async () => {
    let candlestickUrl: string | null = null;

    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      if (url.includes("/trade-api/v2/events/FED-1")) {
        return new Response(
          JSON.stringify({
            event: {
              title: "Fed series",
              category: "Macro",
              event_ticker: "FED-1",
              series_ticker: "FED",
            },
            markets: [],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/trade-api/v2/series/FED/markets/KAL-1/candlesticks")) {
        candlestickUrl = url;
        return new Response(JSON.stringify({ candlesticks: [] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const summary = normalizeKalshiMarket({
      ticker: "KAL-1",
      title: "Will the Fed cut rates?",
      yes_sub_title: "Yes",
      event_ticker: "FED-1",
      status: "open",
      market_type: "binary",
      last_price_dollars: "0.48",
    } as any);

    const history = await loadKalshiHistory(summary!, "1W");
    expect(history).toEqual([]);
    expect(candlestickUrl).toContain("period_interval=60");
  });

  test("normalizes keyboard commands from terminal key sequences", () => {
    expect(resolvePredictionKeyboardCommand({ name: "esc" })).toBe("escape");
    expect(resolvePredictionKeyboardCommand({ sequence: "j" })).toBe(
      "move-down",
    );
    expect(resolvePredictionKeyboardCommand({ sequence: "\u001bOC" })).toBe(
      "next-category",
    );
    expect(
      resolvePredictionKeyboardCommand({
        name: "right",
        sequence: "\u001b[1;2C",
        shift: true,
      }),
    ).toBe("next-venue-tab");
    expect(resolvePredictionKeyboardCommand({ name: "1", sequence: "1" })).toBe(
      "browse-top",
    );
    expect(resolvePredictionKeyboardCommand({ name: "4", sequence: "4" })).toBe(
      "browse-watchlist",
    );
    expect(resolvePredictionKeyboardCommand({ name: "[", sequence: "[" })).toBe(
      "previous-browse-tab",
    );
    expect(resolvePredictionKeyboardCommand({ name: "]", sequence: "]" })).toBe(
      "next-browse-tab",
    );
  });

  test("filters closed Polymarket child markets from the catalog", async () => {
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      if (url.includes("gamma-api.polymarket.com/events?")) {
        return new Response(
          JSON.stringify([
            {
              id: "event-iran",
              title: "US forces enter Iran by..?",
              tags: [{ label: "Geopolitics", slug: "geopolitics" }],
              markets: [
                {
                  id: "open-market",
                  question: "US forces enter Iran by April 30?",
                  groupItemTitle: "April 30",
                  conditionId: "cond-open",
                  outcomes: '["Yes","No"]',
                  outcomePrices: '["0.55","0.45"]',
                  clobTokenIds: '["yes-open","no-open"]',
                  volume24hr: 2500000,
                  spread: 0.01,
                  active: true,
                  closed: false,
                },
                {
                  id: "closed-market",
                  question: "US forces enter Iran by March 15?",
                  groupItemTitle: "March 15",
                  conditionId: "cond-closed",
                  outcomes: '["Yes","No"]',
                  outcomePrices: '["0.01","0.99"]',
                  clobTokenIds: '["yes-closed","no-closed"]',
                  volume24hr: 9999999,
                  spread: 0.01,
                  active: false,
                  closed: true,
                },
              ],
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const markets = await loadPolymarketCatalog("", "all");
    expect(markets).toHaveLength(1);
    expect(markets[0]?.marketLabel).toBe("April 30");
  });

  test("keeps Polymarket catalog results when one page connection resets", async () => {
    let resetFetchCount = 0;

    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      if (url.includes("gamma-api.polymarket.com/events?")) {
        if (url.includes("offset=200")) {
          resetFetchCount += 1;
          throw Object.assign(
            new Error("The socket connection was closed unexpectedly."),
            { code: "ECONNRESET" },
          );
        }
        return new Response(
          JSON.stringify([
            {
              id: "event-stable",
              title: "Stable catalog page",
              tags: [{ label: "Macro", slug: "economy" }],
              markets: [
                {
                  id: "pm-stable",
                  question: "Will the stable page load?",
                  conditionId: "cond-stable",
                  outcomes: '["Yes","No"]',
                  outcomePrices: '["0.57","0.43"]',
                  clobTokenIds: '["yes-stable","no-stable"]',
                  volume24hr: 125000,
                  active: true,
                  closed: false,
                },
              ],
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const markets = await loadPolymarketCatalog("", "all");

    expect(markets).toHaveLength(1);
    expect(markets[0]?.marketId).toBe("pm-stable");
    expect(resetFetchCount).toBe(3);
  });

  test("uses remote catalog endpoints for search and category changes", async () => {
    const { fetchUrls } = installPredictionMarketMocks();

    await loadPolymarketCatalog("inflation", "macro");
    await loadKalshiCatalog("", "macro");

    expect(
      fetchUrls.some((url) =>
        url.includes("gamma-api.polymarket.com/public-search?q=inflation"),
      ),
    ).toBe(true);
    expect(
      fetchUrls.some(
        (url) =>
          url.includes("/trade-api/v2/events?") &&
          url.includes("category=Economics"),
      ),
    ).toBe(true);
  });

  test("routes Kalshi catalog through the same-origin worker proxy in hosted mode", async () => {
    (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED = true;
    attachPredictionMarketsPersistence(new MemoryPersistence());

    const fetchUrls: string[] = [];
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.includes("/events")) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await loadKalshiCatalog("", "all", "top", { force: true });
      expect(
        fetchUrls.some((url) => url.includes(`${KALSHI_PROXY_PATH}/`)),
      ).toBe(true);
      expect(
        fetchUrls.some((url) => url.includes("external-api.kalshi.com")),
      ).toBe(false);
    } finally {
      delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
    }
  });

  test("falls back to thin Polymarket search results when event hydration fails", async () => {
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      if (url.includes("gamma-api.polymarket.com/public-search")) {
        return new Response(
          JSON.stringify({
            events: [
              {
                id: "event-1",
                title: "Fed decision in April?",
                endDate: "2026-04-29T00:00:00Z",
                markets: [
                  {
                    question:
                      "Will the Fed decrease interest rates by 25 bps after the April 2026 meeting?",
                    groupItemTitle: "25 bps decrease",
                    slug: "will-the-fed-decrease-interest-rates-by-25-bps-after-the-april-2026-meeting",
                    outcomes: ["Yes", "No"],
                    outcomePrices: ["0.22", "0.78"],
                    bestBid: 0.21,
                    bestAsk: 0.23,
                    lastTradePrice: 0.22,
                    spread: 0.02,
                    active: true,
                    closed: false,
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("gamma-api.polymarket.com/events/event-1")) {
        return new Response(
          JSON.stringify({
            id: "event-1",
            title: "Fed decision in April?",
            description: "Canonical event",
            resolutionSource: "FOMC",
            openInterest: 500000,
            tags: [{ label: "Macro", slug: "economy" }],
            markets: [
              {
                id: "pm-1",
                question:
                  "Will the Fed decrease interest rates by 25 bps after the April 2026 meeting?",
                groupItemTitle: "25 bps decrease",
                conditionId: "cond-1",
                slug: "will-the-fed-decrease-interest-rates-by-25-bps-after-the-april-2026-meeting",
                outcomes: '["Yes","No"]',
                outcomePrices: '["0.22","0.78"]',
                clobTokenIds: '["yes-1","no-1"]',
                bestBid: 0.21,
                bestAsk: 0.23,
                lastTradePrice: 0.22,
                spread: 0.02,
                volume24hr: 120000,
                volumeNum: 900000,
                liquidityNum: 150000,
                active: true,
                closed: false,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("clob.polymarket.com/prices-history")) {
        return new Response(
          JSON.stringify({ history: [{ t: 1711929600, p: 0.22 }] }),
          { status: 200 },
        );
      }
      if (url.includes("clob.polymarket.com/book?token_id=yes-1")) {
        return new Response(
          JSON.stringify({
            bids: [{ price: "0.21", size: "100" }],
            asks: [{ price: "0.23", size: "120" }],
            last_trade_price: "0.22",
          }),
          { status: 200 },
        );
      }
      if (url.includes("clob.polymarket.com/book?token_id=no-1")) {
        return new Response(
          JSON.stringify({
            bids: [{ price: "0.77", size: "80" }],
            asks: [{ price: "0.79", size: "90" }],
            last_trade_price: "0.78",
          }),
          { status: 200 },
        );
      }
      if (url.includes("data-api.polymarket.com/trades?market=cond-1")) {
        return new Response(
          JSON.stringify([
            {
              transactionHash: "0xabc",
              side: "BUY",
              size: 25,
              price: 0.22,
              timestamp: 1712102400,
              outcome: "Yes",
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const searchResults = await loadPolymarketCatalog("fed", "all");
    const detail = await loadPolymarketDetail(searchResults[0]!, "1M");

    expect(searchResults[0]?.conditionId).toBeUndefined();
    expect(detail.summary.conditionId).toBe("cond-1");
  });

  test("renders Polymarket public-search hits without hydrating every event", async () => {
    const fetchUrls: string[] = [];
    let hydrateStarted = false;

    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.includes("gamma-api.polymarket.com/public-search")) {
        return new Response(
          JSON.stringify({
            events: [
              {
                id: "event-1",
                title: "Fed decision in April?",
                markets: [
                  {
                    question: "Will the Fed cut rates?",
                    slug: "will-the-fed-cut-rates",
                    outcomes: ["Yes", "No"],
                    outcomePrices: ["0.22", "0.78"],
                    active: true,
                    closed: false,
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("gamma-api.polymarket.com/events/event-1")) {
        hydrateStarted = true;
        await new Promise(() => {});
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const searchResults = await loadPolymarketCatalog("fed", "all");
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0]?.title).toContain("Fed");
    expect(hydrateStarted).toBe(false);
    expect(fetchUrls.some((url) => url.includes("/events/event-1"))).toBe(false);
  });

  test("does not page Kalshi search four times when a local catalog exists", async () => {
    const persistence = new MemoryPersistence();
    attachPredictionMarketsPersistence(persistence);
    persistence.setResource(
      "catalog",
      "kalshi:all:all",
      [
        normalizeKalshiMarket({
          ticker: "KAL-FED",
          title: "Will the Fed cut rates?",
          yes_sub_title: "Yes",
          event_ticker: "FED-1",
          status: "open",
          market_type: "binary",
          last_price_dollars: "0.48",
        } as any),
      ].filter(Boolean),
      { cachePolicy: PREDICTION_CACHE_POLICIES.catalog, sourceKey: "remote" },
    );

    let eventPages = 0;
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      if (url.includes("/trade-api/v2/events?")) {
        eventPages += 1;
        return new Response(
          JSON.stringify({
            events: [],
            cursor: `page-${eventPages}`,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    await loadKalshiCatalog("fed", "all", "top", { force: true });
    expect(eventPages).toBe(1);
  });

  test("filters Kalshi markets locally when venue category responses bleed across buckets", async () => {
    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      if (url.includes("/trade-api/v2/events?")) {
        return new Response(
          JSON.stringify({
            events: [
              {
                title: "Fed series",
                sub_title: "Upper bound",
                category: "Economics",
                event_ticker: "FED-1",
                series_ticker: "FED",
                markets: [
                  {
                    ticker: "KAL-MACRO",
                    title:
                      "Will the upper bound of the federal funds target rate be above 4.25%?",
                    yes_sub_title: "Above 4.25%",
                    event_ticker: "FED-1",
                    status: "open",
                    market_type: "binary",
                    last_price_dollars: "0.48",
                    volume_24h_fp: "15000",
                    strike_type: "greater",
                    floor_strike: "4.25",
                  },
                ],
              },
              {
                title: "NBA Finals winner",
                category: "Sports",
                event_ticker: "NBA-1",
                series_ticker: "NBA",
                markets: [
                  {
                    ticker: "KAL-SPORTS",
                    title: "Will the Knicks win the title?",
                    event_ticker: "NBA-1",
                    status: "open",
                    market_type: "binary",
                    last_price_dollars: "0.35",
                    volume_24h_fp: "12000",
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const macroMarkets = await loadKalshiCatalog("", "macro");
    expect(macroMarkets.map((market) => market.marketId)).toEqual([
      "KAL-MACRO",
    ]);
  });
});
