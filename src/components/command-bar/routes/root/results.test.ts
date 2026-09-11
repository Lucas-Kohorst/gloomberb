import { describe, expect, test } from "bun:test";
import type { PaneTemplateDef } from "../../../../types/plugin";
import { orderListResults, type ResultItem } from "../../list/model";
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

  test("keeps searching when a two-letter text prefix is only the first word", () => {
    const screenerTemplate = {
      id: "new-ai-screener-pane",
      paneId: "ai-screener",
      label: "AI Screener",
      description: "Prompt-driven screener",
      shortcut: { prefix: "AI", argPlaceholder: "prompt", argKind: "text" },
    } as PaneTemplateDef;
    const safetyPane: ResultItem = {
      ...paneRow,
      id: "pane-template:safety-monitor",
      label: "Safety Monitor",
      searchText: "ai safety workplace",
    };
    const { items, initialIdx } = buildRootResultModel(rootOptions({
      rootQuery: "ai safety",
      assist: {
        enabled: true,
        auto: true,
        state: { status: "idle" },
        onAsk: () => {},
        onSignUp: () => {},
        onRunCandidate: () => {},
      },
      getAvailablePaneShortcutTemplates: () => [screenerTemplate],
      createPaneTemplateItem: (template) => ({
        id: `pane-template:${template.id}`,
        label: template.label,
        detail: template.description,
        category: "Panes",
        kind: "action",
        action: () => {},
      }),
      paneShortcutItems: () => [safetyPane],
      nonShortcutPaneTemplateItems: () => [safetyPane],
      providerResultItems: [documentRow],
      rootShortcutIntent: {
        kind: "complete",
        source: "pane-template",
        prefix: "AI",
        label: "AI Screener",
        description: "",
        argKind: "text",
        argText: "safety",
        completionQuery: null,
        template: screenerTemplate,
      },
    }));
    const ids = items.map((item) => item.id);
    expect(ids).toContain("pane-template:new-ai-screener-pane");
    expect(ids).toContain(safetyPane.id);
    expect(ids).toContain(documentRow.id);
    expect(ids).toContain("assist:pending");
    expect(ids[initialIdx]).toBe("pane-template:new-ai-screener-pane");
  });

  test.each(["ART", "G", "CORR"])("retains relevant discovery rows for %s without unrelated providers", (prefix) => {
    const chartRow = { ...documentRow, id: "chart-series:example", category: "Chart Series" };
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: `${prefix} example`,
      providerResultItems: [documentRow, chartRow, { ...documentRow, id: "search-provider:unrelated:example" }],
      rootShortcutIntent: {
        kind: "complete", source: "pane-template", prefix, label: prefix,
        description: "", argKind: "text", argText: "example", completionQuery: null,
        template: { id: "example-pane" } as PaneTemplateDef,
      },
    }));
    const ids = items.map((item) => item.id);
    expect(ids).toContain(prefix === "ART" ? documentRow.id : chartRow.id);
    expect(ids).not.toContain(prefix === "ART" ? chartRow.id : documentRow.id);
    expect(ids).not.toContain("search-provider:unrelated:example");
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

  test("keeps a related pane that shares a word when the strict match is empty", () => {
    const weather = {
      ...paneRow,
      id: "pane-template:weather",
      label: "Weather",
      searchText: "weather climate temperature temp nws",
    };
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "alanta temp",
      paneShortcutItems: () => [weather],
    }));
    expect(items.map((item) => item.label)).toContain("Weather");
  });

  test("offers a plugin fallback when nothing local matched", () => {
    let opened = false;
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "zzzznotapane",
      onOpenPluginMarketplace: () => {
        opened = true;
      },
    }));
    expect(items.map((item) => item.id)).toContain("plugin:build");
    items.find((item) => item.id === "plugin:build")?.action();
    expect(opened).toBe(true);
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

  test("keeps the concrete chart and one filtered catalog action for a chartable query", () => {
    const genericCatalog: ResultItem = {
      id: "pane-template:data-catalog",
      label: "Data Catalog",
      detail: "Search every chartable series",
      category: "Panes",
      kind: "action",
      right: "CAT",
      shortcutQuery: "CAT",
      searchText: "data catalog chart series lido tvl",
      action: () => {},
    };
    const chart: ResultItem = {
      id: "chart-series:defillama:lido-tvl",
      label: "Lido TVL",
      detail: "Total value locked",
      category: "Chart Series",
      kind: "action",
      right: "G",
      shortcutQuery: "G",
      action: () => {},
    };
    const filteredCatalog: ResultItem = {
      id: "chart-series:data-catalog",
      label: "Browse Data Catalog",
      detail: "Search “lido tvl” across every series",
      category: "Data Catalog",
      kind: "action",
      right: "CAT",
      shortcutQuery: "CAT",
      action: () => {},
    };
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "lido tvl",
      assist: {
        ...assist,
        state: {
          status: "answered",
          query: "lido tvl",
          source: "auto",
          candidates: [{
            input: "CAT lido tvl",
            title: "Search the data catalog for Lido TVL",
            prefix: "CAT",
            confidence: 0.9,
          }],
        },
      },
      paneShortcutItems: () => [genericCatalog],
      providerResultItems: [chart, filteredCatalog],
    }));

    expect(items.map((item) => item.id)).toEqual([chart.id, filteredCatalog.id]);
  });

  test("keeps an AI catalog action that transforms the query", () => {
    const filteredCatalog: ResultItem = {
      id: "chart-series:data-catalog",
      label: "Browse Data Catalog",
      detail: "Search “lido” across every series",
      category: "Data Catalog",
      kind: "action",
      shortcutQuery: "CAT",
      action: () => {},
    };
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "compare staking protocols",
      assist: {
        ...assist,
        state: {
          status: "answered",
          query: "compare staking protocols",
          source: "auto",
          candidates: [{
            input: "CAT lido tvl",
            title: "Search the data catalog for Lido TVL",
            prefix: "CAT",
            confidence: 0.9,
          }],
        },
      },
      providerResultItems: [filteredCatalog],
    }));

    expect(items.map((item) => item.id)).toEqual([
      "assist:candidate:0:CAT lido tvl",
      filteredCatalog.id,
    ]);
  });
});
