import { describe, expect, test } from "bun:test";
import {
  catalogEmptyCopy,
  catalogExpressionForRow,
  catalogTickerFromInput,
  catalogPollSubjectsFromPolls,
  catalogPredictionSeriesLabel,
  catalogRowsForResolvedInstruments,
  catalogRowsFromLlmStatsRows,
  catalogOwidDiscoveryQuery,
  catalogRowsFromOwidHits,
  catalogRowsFromPollSubjects,
  catalogRowsFromPredictionHits,
  filterCatalogRows,
  listStaticCatalogInventory,
  looksLikeCatalogTickerQuery,
} from "./catalog-inventory";
import type { LlmStatsRow } from "../llm-stats/types";
import { parseSeriesExpression } from "./presets";

const AAPL = { symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc." };
const MSFT = { symbol: "MSFT", exchange: "NASDAQ", name: "Microsoft Corp." };

function language(overrides: Partial<LlmStatsRow> = {}): LlmStatsRow {
  return {
    id: "gpt-4o",
    displayName: "GPT-4o",
    organization: "OpenAI",
    provider: "OpenAI",
    releaseDate: "2024-05-13",
    contextLength: 128000,
    inputPrice: 2.5,
    outputPrice: 10,
    inputModalities: ["text"],
    outputModalities: ["text"],
    tier: null,
    totalCalls: 100,
    failedCalls: 1,
    failureRate: 0.01,
    avgThroughput: 80,
    p5Throughput: 60,
    avgLatency: 2100,
    p95Latency: 3000,
    avgTtft: 400,
    url: "https://llm-stats.com/models/gpt-4o",
    ...overrides,
  };
}

describe("data catalog inventory", () => {
  test("maps source to the provider and kind to the series class", () => {
    const rows = listStaticCatalogInventory([AAPL]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const byExpression = new Map(rows.map((row) => [row.expression, row]));

    expect(byId.get("field:market.ohlcv")).toMatchObject({ source: "Yahoo", kind: "Market", label: "Price (OHLCV)", needsTicker: true, expression: "TICKER:price" });
    expect(byId.get("field:market.dividends")).toMatchObject({ source: "Yahoo", kind: "Dividends", label: "Dividends", needsTicker: true, expression: "TICKER:dvd" });
    expect(byExpression.get("FRED:CPIAUCSL")).toMatchObject({ source: "FRED", kind: "Economic" });
    expect(byExpression.get("UST:10Y")).toMatchObject({ source: "FRED", kind: "Treasury" });
    expect(byExpression.get("FRED:BAMLC0A0CMEY")).toMatchObject({ source: "FRED", kind: "Bond" });
    expect(byExpression.get("FRED:BAMLC0A0CM")).toMatchObject({ source: "FRED", kind: "Credit" });
    expect(byExpression.get("FRED:VIXCLS")).toMatchObject({ source: "FRED", kind: "Volatility" });
    expect(filterCatalogRows(rows, "data", "bond").some((row) => row.expression === "UST:10Y")).toBe(true);
    expect(filterCatalogRows(rows, "data", "bond").some((row) => row.expression === "FRED:BAMLC0A0CMEY")).toBe(true);
    expect(byExpression.get("ADJ:red")).toMatchObject({ source: "Adjacent", kind: "Index" });
    expect(byExpression.get("FUT:ES")).toMatchObject({ source: "Yahoo" });
    expect(byExpression.get("OWID:life-expectancy:OWID_WRL")).toMatchObject({
      source: "Our World in Data",
      kind: "OWID",
      sourceId: "owid",
    });
    expect(rows.some((row) => row.source === "VoteHub" && row.kind === "Poll")).toBe(true);
    expect(rows.some((row) => row.source === "llm-stats.com" && row.kind === "Benchmark")).toBe(true);
  });

  test("lists equity fields once and asks for a ticker when graphing", () => {
    const rows = listStaticCatalogInventory([AAPL, MSFT]);
    const securities = filterCatalogRows(rows, "assets", "").filter((row) => row.sourceId === "security");
    expect(securities.some((row) => row.label === "Close")).toBe(true);
    expect(securities.some((row) => row.label === "PEG Ratio")).toBe(true);
    expect(securities.every((row) => row.needsTicker && row.expression.startsWith("TICKER:"))).toBe(true);
    expect(securities.every((row) => !row.label.includes("AAPL") && !row.label.includes("MSFT"))).toBe(true);
    expect(securities.filter((row) => row.label === "Close")).toHaveLength(1);

    const close = securities.find((row) => row.label === "Close");
    expect(catalogExpressionForRow(close!, "aapl")).toBe("AAPL:close");
    expect(catalogExpressionForRow(close!, "")).toBeNull();
  });

  test("options fields stay in Assets and ask for an option symbol", () => {
    const rows = listStaticCatalogInventory([AAPL]);
    const options = filterCatalogRows(rows, "assets", "").filter((row) => row.sourceId === "option");
    expect(options.some((row) => row.label === "Close")).toBe(true);
    expect(options.some((row) => row.label === "Volume")).toBe(true);
    expect(options.some((row) => row.label === "Price (OHLCV)")).toBe(true);
    expect(options.every((row) => row.needsTicker && row.expression.startsWith("TICKER:"))).toBe(true);
    expect(options.every((row) => row.kind === "Options")).toBe(true);
    expect(options.some((row) => row.label === "PEG Ratio")).toBe(false);
    expect(options.some((row) => row.label === "Dividends")).toBe(false);

    const close = options.find((row) => row.label === "Close");
    expect(catalogExpressionForRow(close!, "AAPL 260618C00200000")).toBe("AAPL260618C00200000:close");
    expect(catalogExpressionForRow(close!, "aapl260618c00200000")).toBe("AAPL260618C00200000:close");
    expect(catalogExpressionForRow(close!, "")).toBeNull();
  });

  test("index and bond instruments only graph market fields", () => {
    const rows = catalogRowsForResolvedInstruments([
      { symbol: "^TNX", assetCategory: "INDEX", name: "10-Year Yield" },
      { symbol: "TLT", assetCategory: "ETF" },
    ]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.kind === "Market")).toBe(true);
    expect(rows.some((row) => row.expression === "^TNX:price")).toBe(true);
    expect(rows.some((row) => row.label.includes("PEG"))).toBe(false);
    expect(rows.some((row) => row.expression === "TLT:price")).toBe(true);
  });

  test("assets vs data splits tradable quotes from macro series", () => {
    const rows = [
      ...listStaticCatalogInventory([
        AAPL,
        { symbol: "ETH-USD", exchange: "CCC", name: "Ethereum USD" },
        { symbol: "EURUSD=X", exchange: "CCY", name: "EUR/USD" },
      ]),
      ...catalogRowsFromPredictionHits([{
        venue: "kalshi",
        marketId: "KXPRESPERSON",
        title: "Who will be the next president?",
      }]),
    ];

    const assets = filterCatalogRows(rows, "assets", "");
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((row) => (
      row.sourceId === "security"
      || row.sourceId === "option"
      || row.sourceId === "crypto"
      || row.sourceId === "fx"
      || row.sourceId === "futures"
      || row.sourceId === "kalshi"
      || row.sourceId === "polymarket"
    ))).toBe(true);
    expect(assets.some((row) => row.sourceId === "crypto")).toBe(true);
    expect(assets.some((row) => row.expression === "EURUSD=X:price")).toBe(true);
    expect(assets.some((row) => row.sourceId === "kalshi")).toBe(true);
    expect(assets.some((row) => row.sourceId === "fred")).toBe(false);
    expect(assets.some((row) => row.sourceId === "owid")).toBe(false);

    const data = filterCatalogRows(rows, "data", "");
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((row) => (
      row.sourceId === "fred"
      || row.sourceId === "treasury"
      || row.sourceId === "adjacent"
      || row.sourceId === "poll"
      || row.sourceId === "benchmark"
      || row.sourceId === "weather"
      || row.sourceId === "owid"
    ))).toBe(true);
    expect(data.some((row) => row.expression === "FRED:CPIAUCSL")).toBe(true);
    expect(data.some((row) => row.expression === "UST:10Y")).toBe(true);
    expect(data.some((row) => row.expression === "ADJ:red")).toBe(true);
    expect(data.some((row) => row.sourceId === "crypto")).toBe(false);
    expect(data.some((row) => row.sourceId === "kalshi")).toBe(false);

    expect(filterCatalogRows(rows, "all", "cpi").some((row) => row.expression === "FRED:CPIAUCSL")).toBe(true);
    expect(filterCatalogRows(rows, "all", "eth").some((row) => row.expression === "ETH-USD:price")).toBe(true);
    expect(looksLikeCatalogTickerQuery("EURUSD=X")).toBe(true);
    expect(catalogTickerFromInput("EURUSD=X")).toBe("EURUSD=X");
    expect(parseSeriesExpression("EURUSD=X:price")).toMatchObject({
      kind: "security",
      symbol: "EURUSD=X",
      fieldId: "market.ohlcv",
    });
  });

  test("crypto pairs sit in Assets next to securities, not as equity field templates", () => {
    const rows = listStaticCatalogInventory([
      AAPL,
      { symbol: "ETH-USD", exchange: "CCC", name: "Ethereum USD" },
    ]);
    const assets = filterCatalogRows(rows, "assets", "");
    const crypto = assets.filter((row) => row.sourceId === "crypto");
    expect(crypto.length).toBeGreaterThan(0);
    expect(crypto.every((row) => row.kind === "Crypto")).toBe(true);
    expect(crypto.some((row) => row.expression === "ETH-USD:price")).toBe(true);
    expect(crypto.some((row) => row.expression === "BTC-USD:price")).toBe(true);
    expect(crypto.every((row) => row.source === "CoinGecko")).toBe(true);
    expect(crypto.every((row) => !row.needsTicker)).toBe(true);
    expect(assets.some((row) => row.sourceId === "security")).toBe(true);
    expect(filterCatalogRows(rows, "data", "").some((row) => row.sourceId === "crypto")).toBe(false);
  });

  test("live Adjacent indices replace the three-entry fallback", () => {
    const rows = listStaticCatalogInventory([], {
      adjacentIndices: [
        { indexId: "blue", name: "BLUE Index", ticker: "BLUE" },
        { indexId: "red", name: "RED Index", ticker: "RED" },
        { indexId: "senate", name: "Senate Control", ticker: "SEN" },
      ],
    });
    const data = filterCatalogRows(rows, "data", "");
    expect(data.filter((row) => row.sourceId === "adjacent")).toHaveLength(3);
    expect(data.some((row) => row.expression === "ADJ:senate")).toBe(true);
  });

  test("maps llm-stats models onto BENCH rows", () => {
    const rows = catalogRowsFromLlmStatsRows([language({ avgThroughput: Number.NaN })]);
    expect(rows.some((row) => row.expression === "BENCH:gpt-4o:p95")).toBe(true);
    expect(rows.some((row) => row.expression === "BENCH:gpt-4o:calls")).toBe(true);
    expect(rows.every((row) => row.source === "llm-stats.com")).toBe(true);
    expect(rows.every((row) => row.kind === "Benchmark")).toBe(true);
    expect(rows.every((row) => row.url?.includes("llm-stats.com"))).toBe(true);
    expect(rows.every((row) => row.searchText.includes("llm-stats"))).toBe(true);
    expect(rows.some((row) => row.expression === "BENCH:gpt-4o:tps")).toBe(false);
  });

  test("Assets is tradable markets; Data is macro, prediction, and alt series", () => {
    const rows = listStaticCatalogInventory([AAPL]);
    const assets = filterCatalogRows(rows, "assets", "");
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((row) => (
      row.sourceId === "security"
      || row.sourceId === "option"
      || row.sourceId === "crypto"
      || row.sourceId === "fx"
      || row.sourceId === "futures"
      || row.sourceId === "kalshi"
      || row.sourceId === "polymarket"
    ))).toBe(true);
    expect(assets.some((row) => row.sourceId === "security" && row.kind === "Market")).toBe(true);
    expect(assets.some((row) => row.sourceId === "option" && row.kind === "Options")).toBe(true);
    expect(assets.some((row) => row.expression === "FUT:ES")).toBe(true);

    const data = filterCatalogRows(rows, "data", "");
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((row) => (
      row.sourceId === "fred"
      || row.sourceId === "treasury"
      || row.sourceId === "adjacent"
      || row.sourceId === "poll"
      || row.sourceId === "benchmark"
      || row.sourceId === "weather"
      || row.sourceId === "owid"
    ))).toBe(true);
    expect(data.some((row) => row.expression === "FRED:CPIAUCSL")).toBe(true);
    expect(data.some((row) => row.expression === "UST:10Y")).toBe(true);
    expect(data.some((row) => row.expression === "ADJ:red")).toBe(true);
    expect(data.some((row) => row.sourceId === "poll")).toBe(true);
    expect(data.some((row) => row.sourceId === "benchmark")).toBe(true);
    expect(data.some((row) => row.expression === "WX:LAX:high")).toBe(true);
    expect(data.some((row) => row.expression === "NWS:KNYC:high")).toBe(true);
  });

  test("Kalshi/Polymarket live rows land in Assets; Adjacent stays in Data", () => {
    const rows = [
      ...listStaticCatalogInventory([AAPL]),
      ...catalogRowsFromPredictionHits([{
        venue: "kalshi",
        marketId: "KXPRESPERSON",
        title: "Who will be the next president?",
      }, {
        venue: "polymarket",
        marketId: "0xabc",
        title: "Will BTC hit 200k?",
      }]),
    ];
    const assets = filterCatalogRows(rows, "assets", "");
    expect(assets.some((row) => row.sourceId === "kalshi")).toBe(true);
    expect(assets.some((row) => row.sourceId === "polymarket")).toBe(true);
    expect(filterCatalogRows(rows, "data", "").some((row) => row.expression === "ADJ:red")).toBe(true);
    expect(filterCatalogRows(rows, "data", "").some((row) => (
      row.sourceId === "kalshi" || row.sourceId === "polymarket"
    ))).toBe(false);
  });

  test("maps live prediction hits onto chartable rows with venue URLs", () => {
    const [row] = catalogRowsFromPredictionHits([{
      venue: "kalshi",
      marketId: "KXPRESPERSON",
      title: "Who will be the next president?",
    }]);
    expect(row).toMatchObject({
      label: "Who will be the next president?",
      expression: "KALSHI:KXPRESPERSON",
      sourceId: "kalshi",
      kind: "Prediction",
      source: "Kalshi",
      url: "https://kalshi.com/markets/KXPRESPERSON",
    });
  });

  test("prediction series titles use the event question, not the strike-only label", () => {
    expect(catalogPredictionSeriesLabel({
      venue: "polymarket",
      marketId: "0xabc",
      title: "What will the price of Bitcoin be on December 31?",
      eventLabel: "Bitcoin price on Dec 31",
      marketLabel: "↑ $10,000",
    })).toBe("What will the price of Bitcoin be on December 31? · ↑ $10,000");

    expect(catalogPredictionSeriesLabel({
      venue: "polymarket",
      marketId: "0xdef",
      title: "-No Qualifying Event-",
      eventLabel: "-No Qualifying Event-",
      marketLabel: "-No Qualifying Event-",
    })).toBe("-No Qualifying Event-");
    expect(catalogRowsFromPredictionHits([{
      venue: "polymarket",
      marketId: "0xdef",
      title: "-No Qualifying Event-",
      marketLabel: "-No Qualifying Event-",
    }])).toEqual([]);

    expect(catalogPredictionSeriesLabel({
      venue: "kalshi",
      marketId: "KXFED",
      title: "Will the Fed cut rates?",
      eventLabel: "Will the Fed cut rates?",
      marketLabel: "Yes",
    })).toBe("Will the Fed cut rates?");

    const [row] = catalogRowsFromPredictionHits([{
      venue: "polymarket",
      marketId: "0xabc",
      title: "What will the price of Bitcoin be on December 31?",
      marketLabel: "↑ $10,000",
    }]);
    expect(row.label).toBe("What will the price of Bitcoin be on December 31? · ↑ $10,000");
    expect(row.label.startsWith("Polymarket")).toBe(false);
  });

  test("does not prefix FRED or Adjacent labels with the source column", () => {
    const rows = listStaticCatalogInventory([]);
    const fred = rows.find((row) => row.expression === "FRED:CPIAUCSL");
    const adjacent = rows.find((row) => row.expression === "ADJ:red");
    expect(fred?.label.startsWith("FRED")).toBe(false);
    expect(fred?.source).toBe("FRED");
    expect(adjacent?.label.startsWith("ADJ")).toBe(false);
    expect(adjacent?.source).toBe("Adjacent");
  });

  test("resolves a ticker query onto chartable rows without treating field names as tickers", () => {
    expect(looksLikeCatalogTickerQuery("AAPL")).toBe(true);
    expect(looksLikeCatalogTickerQuery("btc-usd")).toBe(true);
    expect(looksLikeCatalogTickerQuery("president")).toBe(false);
    expect(looksLikeCatalogTickerQuery("close")).toBe(false);
    expect(looksLikeCatalogTickerQuery("price")).toBe(false);

    const resolved = catalogRowsForResolvedInstruments([AAPL]);
    expect(resolved.some((row) => row.expression === "AAPL:close")).toBe(true);
    expect(resolved.some((row) => row.expression === "AAPL:price")).toBe(true);
    expect(resolved.every((row) => !row.needsTicker && row.label.startsWith("AAPL"))).toBe(true);
    expect(filterCatalogRows(resolved, "assets", "AAPL").some((row) => row.expression === "AAPL:close")).toBe(true);
  });

  test("collapses VoteHub polls onto unique subject and choice chart rows", () => {
    const subjects = catalogPollSubjectsFromPolls([
      {
        subject: "Donald Trump",
        answers: [{ choice: "Approve" }, { choice: "Disapprove" }],
      },
      {
        subject: "Donald Trump",
        answers: [{ choice: "Approve" }, { choice: "Disapprove" }],
      },
      {
        subject: "Wisconsin Senate",
        url: "https://votehub.com/polls/wi",
        answers: [{ choice: "Baldwin" }, { choice: "Hovde" }],
      },
    ]);
    expect(subjects).toEqual([
      { subject: "Donald Trump", choices: ["Approve", "Disapprove"] },
      {
        subject: "Wisconsin Senate",
        choices: ["Baldwin", "Hovde"],
        url: "https://votehub.com/polls/wi",
      },
    ]);
    const [row] = catalogRowsFromPollSubjects(subjects.filter((subject) => subject.subject === "Wisconsin Senate"));
    expect(row.url).toBe("https://votehub.com/polls/wi");
  });

  test("empty copy says loading until catalogs finish, even with a search query", () => {
    expect(catalogEmptyCopy(true, "president")).toEqual({ title: "Loading catalog…" });
    expect(catalogEmptyCopy(true, "")).toEqual({ title: "Loading catalog…" });
    expect(catalogEmptyCopy(false, "president")).toEqual({
      title: 'No series matching "president"',
      hint: "Press / to search.",
    });
    expect(catalogEmptyCopy(false, "")).toEqual({
      title: "No series",
      hint: "Press / to search.",
    });
    expect(catalogEmptyCopy(false, "president", "couldn't load prediction markets")).toEqual({
      title: "couldn't load prediction markets",
      hint: "Press r to retry.",
    });
    expect(catalogEmptyCopy(true, "president", "couldn't load prediction markets")).toEqual({
      title: "Loading catalog…",
    });
  });

  test("maps redistributable OWID hits onto CAT rows and asks for an entity when World is unknown", () => {
    expect(catalogOwidDiscoveryQuery("")).toBe("");
    expect(catalogOwidDiscoveryQuery("owid")).toBe("");
    expect(catalogOwidDiscoveryQuery("life expectancy")).toBe("life expectancy");
    expect(catalogOwidDiscoveryQuery("AAPL")).toBeNull();

    const rows = catalogRowsFromOwidHits(
      [
        {
          title: "Life expectancy",
          slug: "life-expectancy",
          subtitle: null,
          url: "https://ourworldindata.org/grapher/life-expectancy",
          availableEntities: ["World", "United States"],
        },
        {
          title: "Secret chart",
          slug: "secret-chart",
          subtitle: null,
          url: "https://ourworldindata.org/grapher/secret-chart",
          availableEntities: ["World"],
        },
        {
          title: "Mystery mix",
          slug: "mystery-energy-mix",
          subtitle: null,
          url: "https://ourworldindata.org/grapher/mystery-energy-mix",
          availableEntities: ["United States"],
        },
      ],
      new Map([
        ["life-expectancy", {
          slug: "life-expectancy",
          title: "Life expectancy",
          subtitle: null,
          citation: "UN WPP",
          unit: "years",
          license: "CC BY 4.0",
          url: "https://ourworldindata.org/grapher/life-expectancy",
          entities: [{ code: "OWID_WRL", name: "World" }, { code: "USA", name: "United States" }],
        }],
        ["mystery-energy-mix", {
          slug: "mystery-energy-mix",
          title: "Mystery mix",
          subtitle: null,
          citation: null,
          unit: "TWh",
          license: "CC BY 4.0",
          url: "https://ourworldindata.org/grapher/mystery-energy-mix",
          entities: [],
        }],
      ]),
      new Set(["secret-chart"]),
    );
    expect(rows.map((row) => row.expression)).toEqual([
      "OWID:life-expectancy:OWID_WRL",
      "OWID:mystery-energy-mix",
    ]);
    expect(rows.every((row) => row.source === "Our World in Data" && row.sourceId === "owid")).toBe(true);
    expect(rows[0]?.needsEntity).toBe(false);
    expect(rows[0]?.label).toBe("Life expectancy · World");
    expect(rows[1]?.needsEntity).toBe(true);
    expect(catalogExpressionForRow(rows[1]!, "usa")).toBe("OWID:mystery-energy-mix:USA");
    expect(catalogExpressionForRow(rows[1]!, "")).toBeNull();
    expect(filterCatalogRows(rows, "data", "owid").some((row) => row.expression === "OWID:life-expectancy:OWID_WRL")).toBe(true);
    expect(filterCatalogRows(rows, "assets", "").some((row) => row.sourceId === "owid")).toBe(false);
  });
});
