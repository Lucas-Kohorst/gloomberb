import { describe, expect, test } from "bun:test";
import type { PaneTemplateDef } from "../../../../types/plugin";
import type { Command } from "../../commands/registry";
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

  test("bare LAW keeps the Lawsuits pane next to ticker search", () => {
    const lawTemplate = {
      id: "courtlistener-pane",
      paneId: "courtlistener",
      label: "Lawsuits",
      description: "Federal dockets",
      shortcut: { prefix: "LAW", argPlaceholder: "company", argKind: "text", argOptional: true },
    } as PaneTemplateDef;
    const tickerRow: ResultItem = {
      id: "ticker:LAW",
      label: "LAW",
      detail: "CS Disco",
      category: "Exact Match",
      kind: "ticker",
      action: () => {},
    };
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "law",
      getAvailablePaneShortcutTemplates: () => [lawTemplate],
      createPaneTemplateItem: (template) => ({
        id: `pane-template:${template.id}`,
        label: template.label,
        detail: template.description,
        category: "Panes",
        kind: "action",
        right: template.shortcut?.prefix,
        action: () => {},
      }),
      paneShortcutItems: () => [tickerRow],
      rootShortcutIntent: {
        kind: "partial",
        source: "pane-template",
        prefix: "LAW",
        label: "Lawsuits",
        description: "",
        argKind: "text",
        argText: "",
        completionQuery: null,
        template: lawTemplate,
      },
    }));
    const ids = items.map((item) => item.id);
    expect(ids).toContain("pane-template:courtlistener-pane");
    expect(ids).toContain(tickerRow.id);
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

  test("ADJ shows Adjacent catalog rows instead of unrelated providers", () => {
    const catalogRow = {
      ...documentRow,
      id: "search-provider:adjacent-catalog:market:kalshi:kxpres",
      label: "KXPRES",
      detail: "Who will win the election?",
      right: "ADJ",
    };
    const adjCommand = {
      id: "adjacent-markets-search",
      label: "Search Adjacent",
      keywords: ["adjacent"],
      shortcut: "ADJ",
      category: "data" as const,
      execute: () => {},
    };
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "ADJ election",
      providerResultItems: [catalogRow, documentRow],
      createPluginCommandItem: () => ({
        id: "adjacent-markets-search",
        label: "Search Adjacent",
        detail: "election",
        category: "Data",
        kind: "command",
        right: "ADJ",
        action: () => {},
      }),
      rootShortcutIntent: {
        kind: "complete",
        source: "plugin-command",
        prefix: "ADJ",
        label: "Search Adjacent",
        description: "Search Adjacent catalogs",
        argKind: "text",
        argText: "election",
        completionQuery: null,
        command: adjCommand,
      },
    }));
    const ids = items.map((item) => item.id);
    expect(ids[0]).toBe(catalogRow.id);
    expect(ids).toContain("adjacent-markets-search");
    expect(ids).not.toContain(documentRow.id);
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

  test("does not offer Search X when a local command already has that label", () => {
    const deleteRow: ResultItem = {
      id: "command:delete-portfolio",
      label: "Delete Portfolio",
      detail: "Remove a manual portfolio",
      category: "Danger",
      kind: "command",
      action: () => {},
    };
    const searchRow: ResultItem = {
      id: "twitter-search:delete portfolio",
      label: "Delete Portfolio",
      detail: "Open an X advanced-search feed",
      category: "X Feeds",
      kind: "action",
      right: "TWIT",
      action: () => {},
    };
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "Delete Portfolio",
      pluginCommandItems: () => [deleteRow],
      providerResultItems: [searchRow],
    }));
    expect(items.map((item) => item.id)).toContain(deleteRow.id);
    expect(items.map((item) => item.id)).not.toContain(searchRow.id);
  });

  test("still offers the Search X row when nothing else matched", () => {
    const searchRow: ResultItem = {
      id: "twitter-search:why did nvda dump",
      label: "why did nvda dump",
      detail: "Open an X advanced-search feed",
      category: "X Feeds",
      kind: "action",
      right: "TWIT",
      action: () => {},
    };
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "why did nvda dump",
      providerResultItems: [searchRow],
      onOpenPluginMarketplace: () => {},
    }));
    expect(items.map((item) => item.id)).toEqual([searchRow.id]);
    expect(items.map((item) => item.right)).toEqual(["TWIT"]);
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

describe("recents in the root result model", () => {
  const themeCommand: Command = {
    id: "theme",
    prefix: "TH",
    label: "Change Theme",
    description: "Switch color theme",
    category: "Config",
  };
  const recentState = {
    focusedPaneId: null,
    config: { watchlists: [], portfolios: [] },
    recentTickers: ["AAPL"],
    recentCommands: [{ id: "theme", label: "Change Theme" }],
  } as unknown as RootResultModelOptions["state"];

  test("lead the empty query as a Suggested section and re-execute command rows by id", () => {
    const recentTicker: ResultItem = {
      id: "ticker:AAPL",
      label: "AAPL",
      detail: "Apple",
      category: "Exact Match",
      kind: "ticker",
      action: () => {},
    };
    const executed: Array<{ id: string; arg: string }> = [];
    const { items } = buildRootResultModel(rootOptions({
      availableCommands: [themeCommand],
      buildRecentTickerItem: () => recentTicker,
      runDirectCommand: (command, arg) => { executed.push({ id: command.id, arg }); },
      state: recentState,
    }));

    const recentRows = items.filter((item) => item.category === "Suggested");
    expect(recentRows.map((item) => item.id)).toEqual(["ticker:AAPL", "recent:command:theme"]);
    expect(recentRows[0]).toMatchObject({ label: "AAPL", kind: "ticker" });
    expect(recentRows[1]).toMatchObject({ label: "Change Theme", kind: "command", shortcutQuery: "TH" });
    recentRows[1]?.action();
    expect(executed).toEqual([{ id: "theme", arg: "" }]);
  });

  test("re-execute recent commands with the stored arg", () => {
    const executed: Array<{ id: string; arg: string }> = [];
    const { items } = buildRootResultModel(rootOptions({
      availableCommands: [themeCommand],
      runDirectCommand: (command, arg) => { executed.push({ id: command.id, arg }); },
      state: {
        ...recentState,
        recentTickers: [],
        recentCommands: [{ id: "theme", label: "Change Theme", arg: "amber" }],
      },
    }));

    items.find((item) => item.id === "recent:command:theme")?.action();
    expect(executed).toEqual([{ id: "theme", arg: "amber" }]);
  });

  test("never leak into prefix-routed or typed queries", () => {
    for (const query of ["TH", "margin"]) {
      const { items } = buildRootResultModel(rootOptions({
        availableCommands: [themeCommand],
        rootQuery: query,
        state: recentState,
      }));
      expect(items.filter((item) => item.category === "Suggested")).toEqual([]);
    }
  });

  test("re-execute recorded article searches through the article item builder", () => {
    const { items } = buildRootResultModel(rootOptions({
      availableCommands: [],
      buildRecentArticleItem: (articleId, label) => ({
        id: `article:${articleId}`,
        label,
        detail: "Reuters",
        category: "Articles",
        kind: "action",
        action: () => {},
      }),
      state: {
        ...recentState,
        recentTickers: [],
        recentCommands: [{ id: "article:story-1", label: "Fed decision" }],
      },
    }));

    const row = items.find((item) => item.id === "recent:article:story-1");
    expect(row?.category).toBe("Suggested");
    expect(row?.label).toBe("Fed decision");
    expect(row?.action).toBeTypeOf("function");
  });

  test("persisted article recents still produce a row from stored article payload", () => {
    const persisted = {
      id: "story-1",
      title: "Fed decision",
      source: "Reuters",
      url: "https://example.com/fed",
    };
    const received: Array<{ articleId: string; label: string; article?: typeof persisted }> = [];
    const { items } = buildRootResultModel(rootOptions({
      availableCommands: [],
      buildRecentArticleItem: (articleId, label, persistedArticle) => {
        received.push({ articleId, label, article: persistedArticle });
        return {
          id: `article:${articleId}`,
          label,
          detail: persistedArticle?.source ?? "",
          category: "Articles",
          kind: "action",
          action: () => {},
        };
      },
      state: {
        ...recentState,
        recentTickers: [],
        recentCommands: [{ id: "article:story-1", label: "Fed decision", article: persisted }],
      },
    }));

    expect(received).toEqual([{ articleId: "story-1", label: "Fed decision", article: persisted }]);
    expect(items.find((item) => item.id === "recent:article:story-1")).toMatchObject({
      category: "Suggested",
      label: "Fed decision",
      detail: "Reuters",
    });
  });

  test("re-execute recorded pane templates through the template item builder", () => {
    const chartTemplate = {
      id: "chart-composer-pane",
      paneId: "chart-composer",
      label: "Chart",
      description: "Open a new chart",
    } as PaneTemplateDef;
    const { items } = buildRootResultModel(rootOptions({
      availableCommands: [],
      createPaneTemplateItem: (template) => ({
        id: `pane-template:${template.id}`,
        label: template.label,
        detail: template.description,
        category: "Panes",
        kind: "action",
        action: () => {},
      }),
      getRecentPaneTemplate: () => chartTemplate,
      state: {
        ...recentState,
        recentCommands: [{ id: "pane-template:chart-composer-pane", label: "Chart" }],
      },
    }));

    const row = items.find((item) => item.id === "recent:pane-template:chart-composer-pane");
    expect(row?.category).toBe("Suggested");
    expect(row?.label).toBe("Chart");
    expect(row?.action).toBeTypeOf("function");
  });

  test("skip recent entries that no longer resolve to a command or template", () => {
    const { items } = buildRootResultModel(rootOptions({
      availableCommands: [],
      state: {
        ...recentState,
        recentCommands: [{ id: "gone-command", label: "Gone" }],
      },
    }));
    expect(items.filter((item) => item.category === "Suggested")).toEqual([]);
  });
});
