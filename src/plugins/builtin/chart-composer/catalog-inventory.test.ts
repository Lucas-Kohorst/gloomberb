import { describe, expect, test } from "bun:test";
import {
  catalogEmptyCopy,
  catalogExpressionForRow,
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
    expect(byExpression.get("ADJ:red")).toMatchObject({ source: "Adjacent", kind: "Index" });
    expect(byExpression.get("FUT:ES")).toMatchObject({ source: "Yahoo" });
    expect(rows.some((row) => row.source === "VoteHub" && row.kind === "Poll")).toBe(true);
    expect(rows.some((row) => row.source === "llm-stats.com" && row.kind === "Benchmark")).toBe(true);
  });

  test("lists equity fields once and asks for a ticker when graphing", () => {
    const rows = listStaticCatalogInventory([AAPL, MSFT]);
    const securities = filterCatalogRows(rows, "securities", "");
    expect(securities.some((row) => row.label === "Close")).toBe(true);
    expect(securities.some((row) => row.label === "PEG Ratio")).toBe(true);
    expect(securities.every((row) => row.needsTicker && row.expression.startsWith("TICKER:"))).toBe(true);
    expect(securities.every((row) => !row.label.includes("AAPL") && !row.label.includes("MSFT"))).toBe(true);
    expect(securities.filter((row) => row.label === "Close")).toHaveLength(1);

    const close = securities.find((row) => row.label === "Close");
    expect(catalogExpressionForRow(close!, "aapl")).toBe("AAPL:close");
    expect(catalogExpressionForRow(close!, "")).toBeNull();
  });

  test("options tab lists contract market fields and asks for an option symbol", () => {
    const rows = listStaticCatalogInventory([AAPL]);
    const options = filterCatalogRows(rows, "options", "");
    expect(options.some((row) => row.label === "Close")).toBe(true);
    expect(options.some((row) => row.label === "Volume")).toBe(true);
    expect(options.some((row) => row.label === "Price (OHLCV)")).toBe(true);
    expect(options.every((row) => row.needsTicker && row.expression.startsWith("TICKER:"))).toBe(true);
    expect(options.every((row) => row.kind === "Options" && row.sourceId === "option")).toBe(true);
    expect(options.some((row) => row.label === "PEG Ratio")).toBe(false);
    expect(options.some((row) => row.label === "Dividends")).toBe(false);

    const close = options.find((row) => row.label === "Close");
    expect(catalogExpressionForRow(close!, "AAPL 260618C00200000")).toBe("AAPL260618C00200000:close");
    expect(catalogExpressionForRow(close!, "aapl260618c00200000")).toBe("AAPL260618C00200000:close");
    expect(catalogExpressionForRow(close!, "")).toBeNull();
  });

  test("crypto tab lists pairs like prediction markets, not equity fields", () => {
    const rows = listStaticCatalogInventory([
      AAPL,
      { symbol: "ETH-USD", exchange: "CCC", name: "Ethereum USD" },
    ]);
    const crypto = filterCatalogRows(rows, "crypto", "");
    expect(crypto.length).toBeGreaterThan(0);
    expect(crypto.every((row) => row.sourceId === "crypto" && row.kind === "Crypto")).toBe(true);
    expect(crypto.some((row) => row.expression === "ETH-USD:price")).toBe(true);
    expect(crypto.some((row) => row.expression === "BTC-USD:price")).toBe(true);
    expect(crypto.every((row) => !row.needsTicker)).toBe(true);
    expect(filterCatalogRows(rows, "securities", "").some((row) => row.sourceId === "crypto")).toBe(false);
  });

  test("live Adjacent indices replace the three-entry fallback", () => {
    const rows = listStaticCatalogInventory([], {
      adjacentIndices: [
        { indexId: "blue", name: "BLUE Index", ticker: "BLUE" },
        { indexId: "red", name: "RED Index", ticker: "RED" },
        { indexId: "senate", name: "Senate Control", ticker: "SEN" },
      ],
    });
    const other = filterCatalogRows(rows, "other", "");
    expect(other.filter((row) => row.sourceId === "adjacent")).toHaveLength(3);
    expect(other.some((row) => row.expression === "ADJ:senate")).toBe(true);
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

  test("ai filter is benchmarks; other is adjacent and polls; securities are field templates", () => {
    const rows = listStaticCatalogInventory([AAPL]);
    const ai = filterCatalogRows(rows, "ai", "");
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.every((row) => row.sourceId === "benchmark")).toBe(true);

    const other = filterCatalogRows(rows, "other", "");
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((row) => row.sourceId === "poll" || row.sourceId === "adjacent" || row.sourceId === "weather" || row.sourceId === "owid")).toBe(true);
    expect(other.some((row) => row.expression === "ADJ:red")).toBe(true);
    expect(other.some((row) => row.sourceId === "poll")).toBe(true);
    expect(other.some((row) => row.expression === "WX:LAX:high")).toBe(true);
    expect(other.some((row) => row.expression === "NWS:KNYC:high")).toBe(true);

    const securities = filterCatalogRows(rows, "securities", "");
    expect(securities.every((row) => row.sourceId === "security" && row.needsTicker)).toBe(true);
    expect(securities.some((row) => row.kind === "Market")).toBe(true);

    const options = filterCatalogRows(rows, "options", "");
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((row) => row.sourceId === "option" && row.kind === "Options")).toBe(true);
  });

  test("prediction filter is Kalshi/Polymarket only; adjacent stays in other", () => {
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
    const prediction = filterCatalogRows(rows, "prediction", "");
    expect(prediction.length).toBeGreaterThan(0);
    expect(prediction.every((row) => row.sourceId === "kalshi" || row.sourceId === "polymarket")).toBe(true);
    expect(prediction.some((row) => row.sourceId === "adjacent")).toBe(false);

    const other = filterCatalogRows(rows, "other", "red");
    expect(other.some((row) => row.expression === "ADJ:red")).toBe(true);
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
    expect(filterCatalogRows(resolved, "securities", "AAPL").some((row) => row.expression === "AAPL:close")).toBe(true);
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
          title: "Coal production",
          slug: "coal-production",
          subtitle: null,
          url: "https://ourworldindata.org/grapher/coal-production",
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
        ["coal-production", {
          slug: "coal-production",
          title: "Coal production",
          subtitle: null,
          citation: null,
          unit: "TWh",
          license: "CC BY 4.0",
          url: "https://ourworldindata.org/grapher/coal-production",
          entities: [],
        }],
      ]),
    );
    expect(rows.map((row) => row.expression)).toEqual([
      "OWID:life-expectancy:OWID_WRL",
      "OWID:coal-production",
    ]);
    expect(rows.every((row) => row.source === "Our World in Data" && row.sourceId === "owid")).toBe(true);
    expect(rows[0]?.needsEntity).toBe(false);
    expect(rows[1]?.needsEntity).toBe(true);
    expect(catalogExpressionForRow(rows[1]!, "usa")).toBe("OWID:coal-production:USA");
    expect(catalogExpressionForRow(rows[1]!, "")).toBeNull();
    expect(filterCatalogRows(rows, "other", "owid").some((row) => row.expression === "OWID:life-expectancy:OWID_WRL")).toBe(true);
    expect(filterCatalogRows(rows, "fred", "").some((row) => row.sourceId === "owid")).toBe(false);
  });
});
