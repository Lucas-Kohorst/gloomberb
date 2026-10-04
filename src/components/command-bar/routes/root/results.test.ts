import { describe, expect, test } from "bun:test";
import type { PaneTemplateDef } from "../../../../types/plugin";
import { orderListResults, type ResultItem } from "../../list/model";
import { PLUGIN_INSTALL_CATEGORY } from "../../view-model";
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

describe("asset class filter", () => {
  test("lists every class when the query is a class code", () => {
    const { items, initialIdx } = buildRootResultModel(rootOptions({ rootQuery: "EQ" }));
    const classes = items.filter((item) => item.category === "Asset Classes");
    expect(classes.map((item) => item.badge)).toEqual(["EQ", "CUR", "OPT", "FUT", "IDX", "ETF"]);
    expect(classes.map((item) => item.label)).toEqual([
      "Equity",
      "Currency",
      "Option",
      "Future",
      "Index",
      "Exchange-Traded Fund",
    ]);
    expect(initialIdx).toBe(0);
    expect(classes[0]?.right).toBe("Tab");
    expect(classes[1]?.right).toBeUndefined();
    const ordered = orderListResults(items);
    expect(ordered[0]?.category).toBe("Asset Classes");
  });

  test("selects the class the query spells", () => {
    const { items, initialIdx } = buildRootResultModel(rootOptions({ rootQuery: "opt" }));
    expect(items[initialIdx]?.badge).toBe("OPT");
    expect(items[initialIdx]?.right).toBe("Tab");
  });

  test("fills the code and a trailing space", () => {
    let filled = "";
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "CUR",
      setRootQuery: (query) => {
        filled = query;
      },
    }));
    items.find((item) => item.badge === "CUR")?.action();
    expect(filled).toBe("CUR ");
  });

  test("a class code plus a symbol drops the menu and the free-text feed", () => {
    const feed: ResultItem = {
      id: "twitter-search:eq bird",
      label: "eq bird",
      detail: "Open an X advanced-search feed",
      category: "X Feeds",
      kind: "action",
      right: "TWIT",
      action: () => {},
    };
    const { items } = buildRootResultModel(rootOptions({
      rootQuery: "eq bird",
      providerResultItems: [feed],
    }));
    expect(items.some((item) => item.category === "Asset Classes")).toBe(false);
    expect(items.some((item) => item.id.startsWith("twitter-search:"))).toBe(false);
  });

  test("keeps the pane command when the class code is also a pane", () => {
    const futuresTemplate = {
      id: "futures-pane",
      paneId: "futures",
      label: "Futures Board",
      description: "Front-month futures",
      shortcut: { prefix: "FUT" },
    } as PaneTemplateDef;
    const futuresRow: ResultItem = {
      id: "pane-template:futures-pane",
      label: "Futures Board",
      detail: "Front-month futures",
      category: "Panes",
      kind: "action",
      shortcutQuery: "FUT",
      action: () => {},
    };
    const { items, initialIdx } = buildRootResultModel(rootOptions({
      rootQuery: "FUT",
      getAvailablePaneShortcutTemplates: () => [futuresTemplate],
      createPaneTemplateItem: () => futuresRow,
      rootShortcutIntent: {
        kind: "partial",
        source: "pane-template",
        prefix: "FUT",
        label: "Futures Board",
        description: "Front-month futures",
        argKind: null,
        argText: "",
        completionQuery: null,
        template: futuresTemplate,
      },
    }));
    expect(items.some((item) => item.id === futuresRow.id)).toBe(true);
    expect(items.filter((item) => item.category === "Asset Classes")).toHaveLength(6);
    expect(items[initialIdx]?.badge).toBe("FUT");
    expect(items[initialIdx]?.right).toBe("Tab");
  });
});

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
