import { describe, expect, test } from "bun:test";
import type { NewsArticle } from "../../../../news/types";
import type { SecFilingItem } from "../../../../types/data-provider";
import type { PaneTemplateDef } from "../../../../types/plugin";
import { orderListResults, type ResultItem } from "../../list/model";
import { PLUGIN_INSTALL_CATEGORY } from "../../view-model";
import { mergePlainRootTickerResults } from "../ticker-search/results";
import { buildRootResultModel, type RootResultModelOptions } from "./results";

function rootOptions(overrides: Partial<RootResultModelOptions>): RootResultModelOptions {
  const empty = () => [] as ResultItem[];
  return {
    activeCollectionId: null,
    activeTickerData: null,
    activeTickerSymbol: null,
    assist: null,
    availableCommands: [],
    buildLayoutItems: empty,
    buildPaneSettingItems: empty,
    buildWindowModeItems: empty,
    createPaneTemplateItem: () => ({
      id: "template",
      label: "Template",
      detail: "",
      category: "Panes",
      kind: "action",
      action: () => {},
    }),
    createPluginCommandItem: () => ({
      id: "plugin-command",
      label: "Plugin Command",
      detail: "",
      category: "Commands",
      kind: "command",
      action: () => {},
    }),
    currentRoute: null,
    executeCollectionCommand: () => {},
    getAvailablePaneShortcutTemplates: () => [],
    hasPaneSettings: () => false,
    localTickerSearchResultItems: empty,
    nonShortcutPaneTemplateItems: empty,
    openModeRoute: () => {},
    paneShortcutItems: empty,
    pluginCommandItems: empty,
    pluginCommandResultItems: empty,
    rootQuery: "",
    rootShortcutIntent: { kind: "none" },
    runDirectCommand: () => {},
    runSecurityDescriptionShortcut: () => {},
    state: {
      config: { watchlists: [], portfolios: [] },
      focusedPaneId: null,
    } as unknown as RootResultModelOptions["state"],
    tickerActionItems: empty,
    ...overrides,
  };
}

const paneRow: ResultItem = {
  id: "pane-template:margin-monitor",
  label: "Margin Monitor",
  detail: "Track account margin",
  category: "Panes",
  kind: "action",
  action: () => {},
};

const documentRow: ResultItem = {
  id: "search-provider:research-search:documents:hit-1",
  label: "Q3 earnings call",
  detail: "CALL",
  category: "Documents",
  kind: "action",
  lines: [{ segments: [{ text: "margin pressure", emphasis: "match" }] }],
  action: () => {},
};

describe("provider rows in the root result model", () => {
  test("land after the local matches instead of displacing them", () => {
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "margin",
      paneShortcutItems: () => [paneRow],
      providerResultItems: [documentRow],
    }));

    expect(orderListResults(items).map((item) => item.id)).toEqual([paneRow.id, documentRow.id]);
  });

  test("leave the local matches alone when a provider contributes nothing", () => {
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "margin",
      paneShortcutItems: () => [paneRow],
      providerResultItems: [],
    }));

    expect(items.map((item) => item.id)).toEqual([paneRow.id]);
  });

  test("stay out of the way once a prefix claims the query", () => {
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "SEC AAPL",
      providerResultItems: [documentRow],
      rootShortcutIntent: {
        kind: "complete",
        source: "pane-template",
        prefix: "SEC",
        label: "SEC",
        description: "",
        argKind: "ticker",
        argText: "AAPL",
        completionQuery: null,
        template: { id: "sec-pane" } as unknown as PaneTemplateDef,
      },
    }));

    expect(items.map((item) => item.id)).not.toContain(documentRow.id);
  });
});

describe("assist rows in the root result model", () => {
  const assist = {
    enabled: true,
    auto: true,
    state: { status: "idle" as const },
    onAsk: () => {},
    onSignUp: () => {},
    onRunCandidate: () => {},
  };

  test("lead the list ahead of provider rows and keep the Thinking placeholder", () => {
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "margin",
      assist,
      paneShortcutItems: () => [paneRow],
      providerResultItems: [documentRow],
    }));

    expect(orderListResults(items, { categoryPriorities: new Map([["Documents", 200]]) }).map((item) => item.id))
      .toEqual(["assist:pending", paneRow.id, documentRow.id]);
  });

  test("the local matcher no longer drags in panes whose keywords scatter the letters", () => {
    const optionsRow: ResultItem = {
      id: "pane-template:options-calculator",
      label: "Options Calculator",
      detail: "Price options with the Black-Scholes model and view the Greeks",
      searchText: "options greeks implied volatility derivatives pricing",
      category: "Panes",
      kind: "action",
      action: () => {},
    };
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "nvidia",
      paneShortcutItems: () => [optionsRow],
    }));
    expect(items).toEqual([]);

    const { items: abbreviated } = buildRootResultModel(rootOptions({
      rootQuery: "opt calc",
      paneShortcutItems: () => [optionsRow],
    }));
    expect(abbreviated.map((item) => item.id)).toEqual([optionsRow.id]);
  });
});

describe("the plugin install row in the root result model", () => {
  const installRow: ResultItem = {
    id: "plugin-install:prediction-markets:PM",
    label: "Prediction Markets",
    detail: "Event markets",
    category: PLUGIN_INSTALL_CATEGORY,
    kind: "action",
    right: "PM",
    action: () => {},
  };

  test("leads without claiming the query, so the AI and provider rows stay below it", () => {
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "PM",
      assist: {
        enabled: true,
        auto: true,
        state: { status: "idle" as const },
        onAsk: () => {},
        onSignUp: () => {},
        onRunCandidate: () => {},
      },
      pluginInstallItem: installRow,
      providerResultItems: [documentRow],
    }));

    expect(orderListResults(items, { categoryPriorities: new Map([["Documents", 200]]) }).map((item) => item.id))
      .toEqual([installRow.id, "assist:pending", documentRow.id]);
  });
});

function article(overrides: Partial<NewsArticle> & Pick<NewsArticle, "id" | "title">): NewsArticle {
  return {
    url: "https://example.com/story",
    source: "Wire",
    publishedAt: new Date("2026-03-01T00:00:00Z"),
    topic: "markets",
    topics: [],
    sectors: [],
    categories: [],
    tickers: [],
    scores: { importance: 1, urgency: 1, marketImpact: 1, novelty: 1, confidence: 1 },
    isBreaking: false,
    isDeveloping: false,
    importance: 1,
    ...overrides,
  };
}

const appleFiling: SecFilingItem = {
  accessionNumber: "0000320193-26-000001",
  form: "10-K",
  filingDate: new Date("2026-01-30T00:00:00Z"),
  cik: "0000320193",
  companyName: "Apple Inc.",
  filingUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.html",
  primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-20250927.htm",
};

describe("article and filing rows in the root result model", () => {
  test("a three-character headline fragment returns an article row", () => {
    const opened: string[] = [];
    const hormuz = article({ id: "hormuz", title: "Hormuz shipping lane closes" });
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "hor",
      corpusArticles: [
        hormuz,
        article({ id: "fed", title: "Fed holds rates", publishedAt: new Date("2026-04-01T00:00:00Z") }),
      ],
      onOpenCorpusArticle: (item) => opened.push(item.id),
    }));

    expect(items.map((item) => item.id)).toEqual(["article:hormuz"]);
    expect(items[0]).toMatchObject({ category: "Articles", badge: "NEWS", label: hormuz.title });
    items[0]?.action();
    expect(opened).toEqual(["hormuz"]);

    const { items: shortQuery } = buildRootResultModel(rootOptions({
      rootQuery: "ho",
      corpusArticles: [hormuz],
    }));
    expect(shortQuery.filter((item) => item.id.startsWith("article:"))).toEqual([]);
  });

  test("an exact ticker stays ahead of the matching article and filing rows", () => {
    const opened: string[] = [];
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "AAPL",
      corpusArticles: [article({
        id: "aapl-guide",
        title: "AAPL guides higher",
        tickers: ["AAPL"],
      })],
      corpusFilings: [appleFiling],
      onOpenCorpusFiling: (filing, ticker) => opened.push(`${ticker}:${filing.accessionNumber}`),
    }));
    const ticker: ResultItem = {
      id: "ticker:AAPL",
      label: "AAPL",
      detail: "Apple Inc.",
      category: "Search Results",
      kind: "ticker",
      right: "NASDAQ",
      action: () => {},
    };
    const ordered = orderListResults(
      mergePlainRootTickerResults("AAPL", [ticker], items),
      { sectionOrder: "app-first" },
    );

    expect(ordered[0]).toMatchObject({ id: "ticker:AAPL", category: "Exact Match" });
    expect(ordered.map((item) => item.id)).toEqual([
      "ticker:AAPL",
      "article:aapl-guide",
      `filing:${appleFiling.accessionNumber}`,
    ]);
    const filingRow = ordered.find((item) => item.id.startsWith("filing:"));
    expect(filingRow).toMatchObject({ category: "Filings", badge: "10-K", label: "10-K Apple Inc." });
    filingRow?.action();
    expect(opened).toEqual([`AAPL:${appleFiling.accessionNumber}`]);
  });
});
