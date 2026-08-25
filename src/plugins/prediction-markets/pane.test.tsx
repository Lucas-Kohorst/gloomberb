import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
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

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Will inflation fall?");
    expect(frame).toContain("Will the Fed cut rates?");
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
    expect(frame).toContain("[r]efresh");
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

    expect(eventFetches.length).toBeGreaterThanOrEqual(1);
    expect(eventFetches.length).toBeLessThanOrEqual(2);
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

  test("toggles series expand/collapse with Enter and still opens child markets", async () => {
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
    expect(frame).toContain("Will the upper bound of the federal funds target rate be");
    expect(frame).not.toContain("\u2190 Back");

    await emitKeypress(testSetup, { name: "enter", sequence: "\r" });
    await flushFrames(testSetup);

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("▸");
    expect(frame).not.toContain("Will the upper bound of the federal funds target rate be");
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
    expect(frame).toContain("Will the upper bound of the federal funds target rate be");
  });

});
