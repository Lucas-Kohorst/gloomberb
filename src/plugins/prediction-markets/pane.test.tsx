import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import {
  resetUiYieldForTests,
  setUiYieldReason,
} from "../../utils/ui-yield";
import {
  Harness,
  MemoryPersistence,
  PREDICTION_CACHE_POLICIES,
  TEST_PANE_ID,
  WatchlistHarness,
  cleanupPredictionTest,
  emitKeypress,
  flushFrames,
  harnessStateRef,
  installPredictionMarketMocks,
} from "./test-helpers";
import { attachPredictionMarketsPersistence } from "./services/fetch";
import {
  normalizeKalshiMarket,
} from "./services/kalshi/adapter";
import { normalizePolymarketMarket } from "./services/polymarket/adapter";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  resetUiYieldForTests();
  await cleanupPredictionTest(testSetup);
  testSetup = undefined;
});

describe("prediction markets pane interactions", () => {
  test("renders cached catalogs immediately on reopen", async () => {
    const persistence = new MemoryPersistence();
    attachPredictionMarketsPersistence(persistence);

    const cachedPolymarket = normalizePolymarketMarket({
      id: "pm-1",
      question: "Will inflation fall?",
      conditionId: "cond-1",
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.62","0.38"]',
      clobTokenIds: '["yes-1","no-1"]',
      volume24hr: 250000,
      events: [
        {
          id: "event-1",
          title: "US inflation",
          openInterest: 12,
          tags: [{ label: "Macro" }],
        } as any,
      ],
    } as any);
    const cachedKalshi = normalizeKalshiMarket({
      ticker: "KAL-1",
      title: "Will the Fed cut rates?",
      yes_sub_title: "Yes",
      event_ticker: "FED-1",
      status: "open",
      market_type: "binary",
      last_price_dollars: "0.48",
      volume_24h_fp: "15000",
    } as any);

    persistence.setResource(
      "catalog",
      "polymarket:all:all",
      [cachedPolymarket].filter(Boolean),
      { cachePolicy: PREDICTION_CACHE_POLICIES.catalog, sourceKey: "remote" },
    );
    persistence.setResource(
      "catalog",
      "kalshi:all:all",
      [cachedKalshi].filter(Boolean),
      { cachePolicy: PREDICTION_CACHE_POLICIES.catalog, sourceKey: "remote" },
    );

    globalThis.fetch = (async () =>
      new Response("{}", { status: 500 })) as unknown as typeof fetch;

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("Will inflation fall?");
    expect(frame).toContain("Will the Fed cut rates?");
    // The seeded cache paints instantly; the live refresh behind it fails only
    // after the throttled-fetch retry window (750ms base, two retries), and the
    // footer "updated" stamp lands when that attempt settles.
    for (let attempt = 0; attempt < 80 && !frame.includes("updated"); attempt += 1) {
      await act(async () => {
        await Bun.sleep(50);
        await testSetup!.renderOnce();
      });
      frame = testSetup.captureCharFrame();
    }
    expect(frame).toContain("updated");
    expect(frame).toContain("poll 5m");
    expect(frame).not.toContain("poll 20s");
  });

  test("catalog poll chip opens interval options and applying 1m is an opt-in override", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("poll 5m");

    const lines = frame.split("\n");
    const footerRow = lines.findIndex((line) => line.includes("poll 5m"));
    const pollCol = lines[footerRow]?.indexOf("poll 5m") ?? -1;
    expect(footerRow).toBeGreaterThanOrEqual(0);
    expect(pollCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(pollCol + 1, footerRow);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("1 minute");
    expect(frame).toContain("5 minutes");
    expect(frame).toContain("15 minutes");
    expect(frame).toContain("30 minutes");

    const optionLines = frame.split("\n");
    const oneRow = optionLines.findIndex((line) => line.includes("1 minute"));
    expect(oneRow).toBeGreaterThanOrEqual(0);

    const oneCol = optionLines[oneRow]?.indexOf("1 minute") ?? -1;
    expect(oneCol).toBeGreaterThanOrEqual(0);

    await act(async () => {
      await testSetup!.mockMouse.click(oneCol + 1, oneRow);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup);

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("poll 1m");
    expect(frame).not.toContain("poll 5m");
  });

  test("keeps fallback venue markets visible when one catalog fails", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());

    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      if (url.includes("gamma-api.polymarket.com")) {
        throw new Error("Unable to connect. Was there a typo in the url or port?");
      }
      if (url.includes("/trade-api/v2/events?")) {
        return new Response(
          JSON.stringify({
            events: [
              {
                title: "Fed series",
                category: "Economics",
                event_ticker: "FED-1",
                series_ticker: "FED",
                markets: [
                  {
                    ticker: "KAL-1",
                    title: "Will the Fed cut rates?",
                    yes_sub_title: "Yes",
                    event_ticker: "FED-1",
                    status: "open",
                    market_type: "binary",
                    last_price_dollars: "0.48",
                    volume_24h_fp: "15000",
                    volume_fp: "90000",
                    open_interest_fp: "45000",
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

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Will the Fed cut rates?");
    expect(frame).not.toContain("Was there a typo in the url or port?");
  });

  test("shows loading instead of an empty state while empty catalogs are pending", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());

    const releaseFetches: Array<() => void> = [];
    globalThis.fetch = (async (input: Request | string | URL) => {
      await new Promise<void>((resolve) => {
        releaseFetches.push(resolve);
      });
      const url = String(input);
      if (url.includes("/trade-api/v2/events?")) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Loading markets...");
    expect(frame).not.toContain("No markets matched.");

    for (const release of releaseFetches) release();
    await flushFrames(testSetup);
  });

  test("selects a market on single click and opens detail on double click", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("All venues");
    expect(frame).not.toContain("VOL = native venue units");
    expect(frame).toContain("Will inflation fall?");
    expect(frame).toContain("Kalshi");
    expect(frame).toContain("[/] search");
    expect(frame).not.toContain("[r]efresh");
    expect(frame).not.toContain("[1-4]filter");
    expect(frame).not.toContain("[1-3]browse");
    expect(frame).not.toContain("[4]watchlist");

    const lines = frame.split("\n");
    const kalshiRow = lines.findIndex((line) =>
      line.includes("Will the Fed cut rates?"),
    );
    const kalshiCol = lines[kalshiRow]?.indexOf("Will the Fed cut rates?") ?? -1;

    await act(async () => {
      await testSetup!.mockMouse.click(kalshiCol + 1, kalshiRow);
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup);

    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.selectedRowKey,
    ).toBe("kalshi:KAL-1");

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("Will the Fed cut rates?");
    expect(frame).not.toContain("Kalshi primary rule");

    await act(async () => {
      await testSetup!.mockMouse.click(kalshiCol + 1, kalshiRow);
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup);

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("Kalshi primary rule");
    expect(frame).toContain("\u2190 Back Will the Fed cut rates?");
    expect(frame.match(/Will the Fed cut rates\?/g) ?? []).toHaveLength(1);
    expect(frame).not.toContain("[/] search");
    expect(frame).not.toContain("[w]atch");
    expect(frame).not.toContain("[1-4]filter");

    const metricsHeader = frame
      .split("\n")
      .find((line) =>
        line.includes("YES") &&
        line.includes("NO") &&
        line.includes("24H VOL"),
      );
    expect(metricsHeader).toContain("TOTAL VOL");
    expect(metricsHeader).toContain("OI");
    expect(metricsHeader).toContain("SPREAD");
    expect(metricsHeader).toContain("LAST");
    expect(frame).toContain("updated ~0m");
    expect(frame).not.toContain("poll 5s");
  });

  test("focuses the pane when a market row is clicked", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(
      <Harness initialFocusedPaneId="portfolio-list:main" />,
      { width: 120, height: 34 },
    );
    await flushFrames(testSetup);

    expect(harnessStateRef.current?.focusedPaneId).toBe("portfolio-list:main");

    const frame = testSetup.captureCharFrame();
    const lines = frame.split("\n");
    const kalshiRow = lines.findIndex((line) =>
      line.includes("Will the Fed cut rates?"),
    );
    const kalshiCol = lines[kalshiRow]?.indexOf("Will the Fed cut rates?") ?? -1;

    await act(async () => {
      await testSetup!.mockMouse.click(kalshiCol + 1, kalshiRow);
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup);

    expect(harnessStateRef.current?.focusedPaneId).toBe(TEST_PANE_ID);
  });

  test("loads selected detail once instead of refetching in a render loop", async () => {
    const { fetchUrls } = installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    const lines = frame.split("\n");
    const kalshiRow = lines.findIndex((line) =>
      line.includes("Will the Fed cut rates?"),
    );
    const kalshiCol = lines[kalshiRow]?.indexOf("Will the Fed cut rates?") ?? -1;

    await act(async () => {
      await testSetup!.mockMouse.click(kalshiCol + 1, kalshiRow);
      await testSetup!.renderOnce();
      await testSetup!.mockMouse.click(kalshiCol + 1, kalshiRow);
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup, 8);

    const eventFetches = fetchUrls.filter((url) =>
      url.includes("/trade-api/v2/events/FED-1"),
    );
    const orderbookFetches = fetchUrls.filter((url) =>
      url.includes("/trade-api/v2/markets/KAL-1/orderbook"),
    );
    const tradeFetches = fetchUrls.filter((url) =>
      url.includes("/trade-api/v2/markets/trades?ticker=KAL-1"),
    );
    const historyFetches = fetchUrls.filter((url) =>
      url.includes("/trade-api/v2/series/FED/markets/KAL-1/candlesticks"),
    );

    expect(eventFetches).toHaveLength(1);
    expect(orderbookFetches).toHaveLength(1);
    expect(tradeFetches).toHaveLength(1);
    expect(historyFetches).toHaveLength(1);
    expect(testSetup.captureCharFrame()).not.toContain("Loading market detail...");
  });

  test("cycles filter tabs with [ and ] without number-key shortcuts", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    const pluginState = () =>
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ];

    expect(pluginState()?.selectedRowKey).not.toBeNull();
    const categoryBefore = pluginState()?.categoryId;

    await emitKeypress(testSetup, { name: "2", sequence: "2" });
    await flushFrames(testSetup);
    expect(pluginState()?.categoryId).toBe(categoryBefore);

    await emitKeypress(testSetup, { name: "]", sequence: "]" });
    await flushFrames(testSetup);
    expect(pluginState()?.categoryId).toBe("watchlist");

    await emitKeypress(testSetup, { name: "[", sequence: "[" });
    await flushFrames(testSetup);
    expect(pluginState()?.categoryId).toBe("all");
  });

  test("filters the loaded catalog immediately while remote search is still pending", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    await emitKeypress(testSetup, { name: "/", sequence: "/" });
    await flushFrames(testSetup, 1);
    await emitKeypress(testSetup, {
      name: "f",
      sequence: "f",
      targetEditable: true,
    });
    await emitKeypress(testSetup, {
      name: "e",
      sequence: "e",
      targetEditable: true,
    });
    await emitKeypress(testSetup, {
      name: "d",
      sequence: "d",
      targetEditable: true,
    });
    await flushFrames(testSetup, 1);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Will the Fed cut rates?");
    expect(frame).not.toContain("Will inflation fall?");
    expect(frame).not.toContain("Searching markets...");
  });

  test("shows Adjacent Kalshi diesel hits that are missing from the browse catalog", async () => {
    installPredictionMarketMocks();
    const innerFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.adjacent.markets") && url.includes("search=")) {
        const parsed = new URL(url);
        if (
          parsed.searchParams.get("search") === "diesel"
          && parsed.searchParams.get("platform") === "kalshi"
        ) {
          return new Response(
            JSON.stringify({
              data: [{
                market_id: "kalshi:KXDIESELMON-26SEP30-T6.60",
                ticker: "KXDIESELMON-26SEP30-T6.60",
                platform: "kalshi",
                question: "Will the U.S. EIA weekly average diesel price be above $6.60?",
                link: "https://kalshi.com/markets/kxdieselmon/kxdieselmon-26sep30",
                status: "active",
                probability: 12,
                event_title: "Monthly U.S. diesel price",
              }],
              meta: { has_next: false },
            }),
            { status: 200 },
          );
        }
        if (parsed.searchParams.get("search") === "diesel") {
          return new Response(
            JSON.stringify({ data: [], meta: { has_next: false } }),
            { status: 200 },
          );
        }
      }
      return innerFetch(input, init);
    }) as typeof fetch;

    // Desktop search holds the `input` yield reason with no timeout. Results
    // still have to paint; waiting for quiet is how the pane used to stay empty.
    setUiYieldReason("input", true);

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    await emitKeypress(testSetup, { name: "/", sequence: "/" });
    await flushFrames(testSetup, 1);
    for (const letter of "diesel") {
      await emitKeypress(testSetup, {
        name: letter,
        sequence: letter,
        targetEditable: true,
      });
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await flushFrames(testSetup, 8);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("diesel");
    expect(frame).not.toContain("No markets matched.");
    expect(frame).not.toContain("Will the Fed cut rates?");
  });

  test("paints Kalshi diesel hits for a focused All-venues ? diesel query", async () => {
    installPredictionMarketMocks();
    const innerFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.adjacent.markets") && url.includes("search=")) {
        requested.push(url);
        const parsed = new URL(url);
        const search = parsed.searchParams.get("search");
        const platform = parsed.searchParams.get("platform");
        if (search === "diesel" && platform === "kalshi") {
          return new Response(
            JSON.stringify({
              data: [{
                market_id: "kalshi:KXDIESELW-26SEP21-T6.38",
                ticker: "KXDIESELW-26SEP21-T6.38",
                platform: "kalshi",
                question: "Will the U.S. EIA weekly average diesel price be above $6.38?",
                status: "active",
                probability: 18,
                event_title: "Weekly U.S. diesel price",
              }],
              meta: { has_next: false },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ data: [], meta: { has_next: false } }),
          { status: 200 },
        );
      }
      return innerFetch(input, init);
    }) as typeof fetch;

    // Desktop search holds the `input` yield reason with no timeout.
    setUiYieldReason("input", true);
    testSetup = await testRender(
      <Harness initialSearchQuery="? diesel" initialVenueScope="all" />,
      { width: 120, height: 34 },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await flushFrames(testSetup, 8);

    const frame = testSetup.captureCharFrame();
    expect(requested.some((url) => url.includes("search=diesel") && url.includes("platform=kalshi"))).toBe(true);
    expect(requested.some((url) => url.includes("search=%3F") || url.includes("search=?"))).toBe(false);
    expect(frame).toContain("KXDIESELW");
    expect(frame).not.toContain("No markets matched.");
    expect(frame).not.toContain("Will the Fed cut rates?");
  });

  test("moves selection through the list with keyboard navigation without opening detail", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    await emitKeypress(testSetup, { name: "j", sequence: "j" });
    await flushFrames(testSetup);
    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.selectedRowKey,
    ).not.toBeNull();

    await emitKeypress(testSetup, { name: "j", sequence: "j" });
    await flushFrames(testSetup);

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Will the Fed cut rates?");
    expect(frame).not.toContain("Kalshi primary rule");
    expect(frame).not.toContain("\u2190 Back");
  });

  test("moves focus between search and the market table with arrows", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    await emitKeypress(testSetup, { name: "j", sequence: "j" });
    await flushFrames(testSetup, 1);

    await emitKeypress(testSetup, { name: "up", sequence: "\u001b[A" });
    await flushFrames(testSetup);

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("/ search markets");

    await emitKeypress(testSetup, { name: "up", sequence: "\u001b[A" });
    await flushFrames(testSetup);

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("? search markets");

    await emitKeypress(testSetup, {
      name: "down",
      sequence: "\u001b[B",
      targetEditable: true,
    });
    await flushFrames(testSetup);

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("/ search markets");
  });

  test("navigates the book and trades tables with arrow keys", async () => {
    installPredictionMarketMocks();

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);
    await emitKeypress(testSetup, { name: "j", sequence: "j" });
    await emitKeypress(testSetup, { name: "enter", sequence: "\r" });
    await flushFrames(testSetup);

    let rows = testSetup.captureCharFrame().split("\n");
    const detailTabsRow = rows.findIndex((line) =>
      line.includes("Overview") && line.includes("Book") && line.includes("Trades"),
    );
    const bookColumn = rows[detailTabsRow]!.indexOf("Book");
    await act(async () => {
      await testSetup!.mockMouse.click(bookColumn, detailTabsRow);
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup);

    rows = testSetup.captureCharFrame().split("\n");
    let headerRow = rows.findIndex((line) =>
      line.includes("OUT") && line.includes("SIDE") && line.includes("PRICE"),
    );
    expect(headerRow).toBeGreaterThanOrEqual(0);
    let spans = testSetup.captureSpans().lines;
    const bookFirstBefore = spans[headerRow + 1]!.spans.find(
      (span) => span.text.trim(),
    )!.bg;
    const bookSecondBefore = spans[headerRow + 2]!.spans.find(
      (span) => span.text.trim(),
    )!.bg;
    expect(bookFirstBefore).not.toEqual(bookSecondBefore);

    await emitKeypress(testSetup, { name: "down", sequence: "\u001b[B" });
    await flushFrames(testSetup);
    spans = testSetup.captureSpans().lines;
    expect(
      spans[headerRow + 1]!.spans.find((span) => span.text.trim())!.bg,
    ).toEqual(bookSecondBefore);
    expect(
      spans[headerRow + 2]!.spans.find((span) => span.text.trim())!.bg,
    ).toEqual(bookFirstBefore);

    rows = testSetup.captureCharFrame().split("\n");
    const tradesColumn = rows[detailTabsRow]!.indexOf("Trades");
    await act(async () => {
      await testSetup!.mockMouse.click(tradesColumn, detailTabsRow);
      await testSetup!.renderOnce();
    });
    await flushFrames(testSetup);

    rows = testSetup.captureCharFrame().split("\n");
    headerRow = rows.findIndex((line) =>
      line.includes("TIME") && line.includes("SIDE") && line.includes("PRICE"),
    );
    expect(headerRow).toBeGreaterThanOrEqual(0);
    spans = testSetup.captureSpans().lines;
    const tradeFirstBefore = spans[headerRow + 1]!.spans.find(
      (span) => span.text.trim(),
    )!.bg;
    const tradeSecondBefore = spans[headerRow + 2]!.spans.find(
      (span) => span.text.trim(),
    )!.bg;
    expect(tradeFirstBefore).not.toEqual(tradeSecondBefore);

    await emitKeypress(testSetup, { name: "down", sequence: "\u001b[B" });
    await flushFrames(testSetup);
    spans = testSetup.captureSpans().lines;
    expect(
      spans[headerRow + 1]!.spans.find((span) => span.text.trim())!.bg,
    ).toEqual(tradeSecondBefore);
    expect(
      spans[headerRow + 2]!.spans.find((span) => span.text.trim())!.bg,
    ).toEqual(tradeFirstBefore);
  });

  test("supports detail outcome navigation and escape return from the keyboard", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());

    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      if (url.includes("gamma-api.polymarket.com/events?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/trade-api/v2/events?")) {
        return new Response(
          JSON.stringify({
            events: [
              {
                title: "Federal funds target rate after April 2026 FOMC",
                sub_title: "Upper bound",
                category: "Economics",
                event_ticker: "FED-1",
                series_ticker: "FED",
                markets: [
                  {
                    ticker: "KXFED-27APR-T4.25",
                    title:
                      "Will the upper bound of the federal funds target rate be above 4.25%?",
                    yes_sub_title: "Above 4.25%",
                    event_ticker: "FED-1",
                    status: "open",
                    market_type: "binary",
                    last_price_dollars: "0.48",
                    volume_24h_fp: "15000",
                    volume_fp: "90000",
                    open_interest_fp: "45000",
                    liquidity_dollars: "250000",
                    rules_primary: "Rule 1",
                  },
                  {
                    ticker: "KXFED-27APR-T4.50",
                    title:
                      "Will the upper bound of the federal funds target rate be above 4.50%?",
                    yes_sub_title: "Above 4.50%",
                    event_ticker: "FED-1",
                    status: "open",
                    market_type: "binary",
                    last_price_dollars: "0.31",
                    volume_24h_fp: "12000",
                    volume_fp: "70000",
                    open_interest_fp: "35000",
                    liquidity_dollars: "190000",
                    rules_primary: "Rule 2",
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/trade-api/v2/events/FED-1")) {
        return new Response(
          JSON.stringify({
            event: {
              title: "Federal funds target rate after April 2026 FOMC",
              sub_title: "Upper bound",
              category: "Economics",
              event_ticker: "FED-1",
              series_ticker: "FED",
            },
            markets: [
              {
                ticker: "KXFED-27APR-T4.25",
                title:
                  "Will the upper bound of the federal funds target rate be above 4.25%?",
                yes_sub_title: "Above 4.25%",
                event_ticker: "FED-1",
                status: "open",
                market_type: "binary",
                last_price_dollars: "0.48",
                volume_24h_fp: "15000",
                rules_primary: "Rule 1",
              },
              {
                ticker: "KXFED-27APR-T4.50",
                title:
                  "Will the upper bound of the federal funds target rate be above 4.50%?",
                yes_sub_title: "Above 4.50%",
                event_ticker: "FED-1",
                status: "open",
                market_type: "binary",
                last_price_dollars: "0.31",
                volume_24h_fp: "12000",
                rules_primary: "Rule 2",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/trade-api/v2/series/FED/markets/")) {
        return new Response(JSON.stringify({ candlesticks: [] }), {
          status: 200,
        });
      }
      if (url.includes("/trade-api/v2/markets/")) {
        return new Response(
          JSON.stringify({ orderbook_fp: { yes_dollars: [], no_dollars: [] } }),
          { status: 200 },
        );
      }
      if (url.includes("/trade-api/v2/markets/trades?ticker=")) {
        return new Response(JSON.stringify({ trades: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    testSetup = await testRender(<Harness />, { width: 120, height: 34 });
    await flushFrames(testSetup);

    await emitKeypress(testSetup, { name: "j", sequence: "j" });
    await flushFrames(testSetup);
    // Hosted web normalizes Enter to "return"; both names must expand a group.
    await emitKeypress(testSetup, { name: "return", sequence: "\r" });
    await flushFrames(testSetup);

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("▾");
    // Children render under the group; the MARKET column truncates the long
    // question, and the collapsed group's TOP ODDS cell never reaches this far.
    expect(frame).toContain("Will the upper bound of the f");
    expect(frame).not.toContain("\u2190 Back");

    await emitKeypress(testSetup, { name: "enter", sequence: "\r" });
    await flushFrames(testSetup);

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("▸");
    expect(frame).not.toContain("Will the upper bound of the f");
    expect(frame).not.toContain("\u2190 Back");

    await emitKeypress(testSetup, { name: "enter", sequence: "\r" });
    await flushFrames(testSetup);
    await emitKeypress(testSetup, { name: "j", sequence: "j" });
    await flushFrames(testSetup);
    await emitKeypress(testSetup, { name: "enter", sequence: "\r" });
    await flushFrames(testSetup);
    await emitKeypress(testSetup, { name: "down", sequence: "\u001b[B" });
    await flushFrames(testSetup);

    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.selectedDetailMarketKey,
    ).toBe("kalshi:KXFED-27APR-T4.50");

    await emitKeypress(testSetup, { name: "escape", sequence: "\u001b" });
    await flushFrames(testSetup);

    const escapeFrame = testSetup.captureCharFrame();
    expect(escapeFrame).toContain("search markets");
    expect(escapeFrame).not.toContain("Rule 2");
    expect(
      harnessStateRef.current?.paneState[TEST_PANE_ID]?.pluginState?.[
        "prediction-markets"
      ]?.selectedDetailMarketKey,
    ).toBe("kalshi:KXFED-27APR-T4.50");
  });

  test("expands a grouped event from the watchlist with Enter", async () => {
    attachPredictionMarketsPersistence(new MemoryPersistence());

    globalThis.fetch = (async (input: Request | string | URL) => {
      const url = String(input);
      if (url.includes("gamma-api.polymarket.com/events?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/trade-api/v2/events?")) {
        return new Response(
          JSON.stringify({
            events: [
              {
                title: "Federal funds target rate after April 2026 FOMC",
                sub_title: "Upper bound",
                category: "Economics",
                event_ticker: "FED-1",
                series_ticker: "FED",
                markets: [
                  {
                    ticker: "KXFED-27APR-T4.25",
                    title:
                      "Will the upper bound of the federal funds target rate be above 4.25%?",
                    yes_sub_title: "Above 4.25%",
                    event_ticker: "FED-1",
                    status: "open",
                    market_type: "binary",
                    last_price_dollars: "0.48",
                    volume_24h_fp: "15000",
                    volume_fp: "90000",
                    open_interest_fp: "45000",
                    liquidity_dollars: "250000",
                  },
                  {
                    ticker: "KXFED-27APR-T4.50",
                    title:
                      "Will the upper bound of the federal funds target rate be above 4.50%?",
                    yes_sub_title: "Above 4.50%",
                    event_ticker: "FED-1",
                    status: "open",
                    market_type: "binary",
                    last_price_dollars: "0.31",
                    volume_24h_fp: "12000",
                    volume_fp: "70000",
                    open_interest_fp: "35000",
                    liquidity_dollars: "190000",
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/trade-api/v2/events/FED-1")) {
        return new Response(
          JSON.stringify({
            event: {
              title: "Federal funds target rate after April 2026 FOMC",
              sub_title: "Upper bound",
              category: "Economics",
              event_ticker: "FED-1",
              series_ticker: "FED",
            },
            markets: [
              {
                ticker: "KXFED-27APR-T4.25",
                title:
                  "Will the upper bound of the federal funds target rate be above 4.25%?",
                yes_sub_title: "Above 4.25%",
                event_ticker: "FED-1",
                status: "open",
                market_type: "binary",
                last_price_dollars: "0.48",
                volume_24h_fp: "15000",
              },
              {
                ticker: "KXFED-27APR-T4.50",
                title:
                  "Will the upper bound of the federal funds target rate be above 4.50%?",
                yes_sub_title: "Above 4.50%",
                event_ticker: "FED-1",
                status: "open",
                market_type: "binary",
                last_price_dollars: "0.31",
                volume_24h_fp: "12000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    testSetup = await testRender(
      <WatchlistHarness
        initialCategoryId="watchlist"
        initialWatchlist={["kalshi:KXFED-27APR-T4.25"]}
      />,
      { width: 120, height: 34 },
    );
    await flushFrames(testSetup);

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("Watchlist");
    expect(frame).toContain("Federal funds target rate");
    expect(frame).toContain("▸");

    await emitKeypress(testSetup, { name: "enter", sequence: "\r" });
    await flushFrames(testSetup);

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("▾");
    expect(frame).toContain("Will the upper bound of the f");
  });

});
