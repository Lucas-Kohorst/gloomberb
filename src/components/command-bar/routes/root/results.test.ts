import { describe, expect, test } from "bun:test";
import type { PaneTemplateDef } from "../../../../types/plugin";
import type { Command } from "../../commands/registry";
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

  test("an empty query includes Suggested rows and re-executes a command by id", () => {
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
    expect(orderListResults(items)[0]?.category).toBe("Suggested");
    recentRows[1]?.action();
    expect(executed).toEqual([{ id: "theme", arg: "" }]);
  });

  test("a typed query or a prefix that owns the query drops Suggested rows", () => {
    for (const query of ["TH", "margin"]) {
      const { items } = buildRootResultModel(rootOptions({
        availableCommands: [themeCommand],
        rootQuery: query,
        state: recentState,
      }));
      expect(items.filter((item) => item.category === "Suggested")).toEqual([]);
    }
  });

  test("re-executes a recent command with its stored argument", () => {
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

    items.find((item) => item.id === "recent:command:theme:amber")?.action();
    expect(executed).toEqual([{ id: "theme", arg: "amber" }]);
  });

  test("caps recent ticker rows at 8", () => {
    const symbols = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
    const { items } = buildRootResultModel(rootOptions({
      buildRecentTickerItem: (symbol) => ({
        id: `ticker:${symbol}`,
        label: symbol,
        detail: "",
        category: "Exact Match",
        kind: "ticker",
        action: () => {},
      }),
      state: {
        ...recentState,
        recentTickers: symbols,
        recentCommands: [],
      },
    }));

    expect(items.filter((item) => item.category === "Suggested").map((item) => item.id)).toEqual(
      symbols.slice(0, 8).map((symbol) => `ticker:${symbol}`),
    );
  });

  test("re-executes a recorded pane template, including a stored argument", () => {
    const chartTemplate = {
      id: "ticker-news-pane",
      paneId: "ticker-news",
      label: "Ticker News",
      description: "News for one ticker",
    } as PaneTemplateDef;
    const created: Array<string | undefined> = [];
    const { items } = buildRootResultModel(rootOptions({
      availableCommands: [],
      createPaneTemplateItem: (template, options) => {
        created.push(options?.createOptions?.arg);
        return {
          id: `pane-template:${template.id}`,
          label: template.label,
          detail: template.description,
          category: "Panes",
          kind: "action",
          action: () => {},
        };
      },
      getRecentPaneTemplate: () => chartTemplate,
      state: {
        ...recentState,
        recentTickers: [],
        recentCommands: [
          { id: "pane-template:ticker-news-pane", label: "Ticker News" },
          { id: "pane-template:ticker-news-pane", label: "Ticker News", arg: "MSFT" },
        ],
      },
    }));

    expect(created).toEqual([undefined, "MSFT"]);
    expect(items.filter((item) => item.category === "Suggested").map((item) => ({
      id: item.id,
      detail: item.detail,
    }))).toEqual([
      { id: "recent:pane-template:ticker-news-pane", detail: "News for one ticker" },
      { id: "recent:pane-template:ticker-news-pane:MSFT", detail: "MSFT" },
    ]);
  });

  test("skips a recent entry that no longer resolves", () => {
    const { items } = buildRootResultModel(rootOptions({
      availableCommands: [],
      state: {
        ...recentState,
        recentTickers: [],
        recentCommands: [{ id: "gone-command", label: "Gone" }, { id: "article:story-1", label: "Fed decision" }],
      },
    }));
    expect(items.filter((item) => item.category === "Suggested")).toEqual([]);
  });
});
