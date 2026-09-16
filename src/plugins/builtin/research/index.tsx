import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PluginModule } from "../plugin-module";
import type { PaneSettingsContext, PaneSettingsDef, TickerResearchTabPrefetchContext } from "../../../types/plugin";
import { parseTickerListInput, formatTickerListInput } from "../../../tickers/list";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { AnalystResearchView } from "./analyst-pane";
import { CorporateActionsView } from "./corporate-actions-pane";
import { EquityDiagnosticView } from "./equity-diagnostic-pane";
import { RelativeValuationPane } from "./relative-valuation-pane";
import { PortfolioEventsPane } from "./portfolio-events-pane";

function EarningsEstimatesPane(props: { focused: boolean; width: number; height: number }) {
  return (
    <CorporateActionsView
      {...props}
      footerPaneId="earnings-estimates"
      variant="earnings-estimates"
    />
  );
}

function prefetchAnalystResearch({ ticker, dataProvider }: TickerResearchTabPrefetchContext): void {
  if (!dataProvider?.getAnalystResearch) return;
  void dataProvider.getAnalystResearch(ticker.metadata.ticker, ticker.metadata.exchange).catch(() => {});
}

function prefetchCorporateActions({ ticker, dataProvider }: TickerResearchTabPrefetchContext): void {
  if (!dataProvider?.getCorporateActions) return;
  void dataProvider.getCorporateActions(ticker.metadata.ticker, ticker.metadata.exchange).catch(() => {});
}

/** The pane's scope lives in its settings, so it has to be editable there too. */
function portfolioEventsSettings(context: PaneSettingsContext): PaneSettingsDef | null {
  const collections = [
    ...context.config.portfolios.map((portfolio) => ({ value: portfolio.id, label: portfolio.name })),
    ...context.config.watchlists.map((watchlist) => ({ value: watchlist.id, label: watchlist.name })),
  ];
  if (collections.length === 0) return null;
  return {
    title: "Portfolio Events Scope",
    fields: [
      {
        key: "collectionId",
        label: "Collection",
        description: "Automatic follows the collection this pane was opened from, then the first portfolio or watchlist.",
        type: "select",
        options: [{ value: "", label: "Automatic" }, ...collections],
      },
    ],
  };
}

export const researchModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "analyst-research",
      name: "Analyst",
      order: 32,
      component: AnalystResearchView,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
      prefetch: prefetchAnalystResearch,
    });
    ctx.registerTickerResearchTab({
      id: "equity-diagnostic",
      name: "Diagnostic",
      order: 33,
      component: EquityDiagnosticView,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
    ctx.registerTickerResearchTab({
      id: "corporate-actions",
      name: "Events",
      order: 34,
      component: CorporateActionsView,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
      prefetch: prefetchCorporateActions,
    });
    ctx.registerAgentPromptFragment(
      "Portfolio Events: pane.createFromTemplate portfolio-events-pane (PEVT) to review upcoming earnings, dividends, splits, and estimates across the active portfolio or watchlist.",
    );
  },

  panes: [
    {
      id: "relative-valuation",
      name: "Relative Valuation",
      icon: "R",
      component: RelativeValuationPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 104, height: 24 },
      tableExport: true,
    },
    {
      id: "earnings-estimates",
      name: "Earnings Estimates",
      icon: "E",
      component: EarningsEstimatesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 104, height: 22 },
      tableExport: true,
    },
    {
      id: "portfolio-events",
      name: "Portfolio Events",
      icon: "V",
      component: PortfolioEventsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 92, height: 24 },
      tableExport: true,
      settings: portfolioEventsSettings,
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "analyst-research-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Analyst Research",
      description: "Price targets, recommendations, and recent analyst actions.",
      keywords: ["analyst", "research", "ratings", "target", "anr"],
      shortcut: "ANR",
      publicShare: true,
      settings: () => ({ defaultTabId: "analyst-research" }),
    }),
    createTickerSurfacePaneTemplate({
      id: "equity-diagnostic-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Equity Diagnostic",
      description: "Red flags, anomalies, green flags, and watch items for one company, with cited evidence.",
      keywords: ["diagnostic", "diag", "red flags", "anomalies", "green flags", "review", "evidence"],
      shortcut: "DIAG",
      publicShare: true,
      settings: () => ({ defaultTabId: "equity-diagnostic" }),
    }),
    createTickerSurfacePaneTemplate({
      id: "corporate-actions-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Corporate Actions",
      description: "Dividends, splits, reported earnings, and analyst estimates.",
      keywords: ["events", "corporate", "actions", "dividend", "split", "earnings", "estimate", "revenue", "evt"],
      shortcut: "EVT",
      publicShare: true,
      settings: () => ({ defaultTabId: "corporate-actions" }),
    }),
    createTickerSurfacePaneTemplate({
      id: "earnings-estimates-pane",
      paneId: "earnings-estimates",
      label: "Earnings Estimates",
      description: "EPS and revenue estimates with reported earnings.",
      keywords: ["earnings", "estimates", "ee", "analyst", "eps", "revenue", "events"],
      shortcut: "EE",
      publicShare: true,
    }),
    {
      id: "portfolio-events-pane",
      paneId: "portfolio-events",
      label: "Portfolio Events",
      description: "Upcoming earnings, dividends, splits, and estimates across a portfolio or watchlist.",
      keywords: ["portfolio", "watchlist", "events", "earnings", "dividend", "split", "calendar", "pevt"],
      category: "Portfolio",
      shortcut: { prefix: "PEVT" },
      createInstance: (context) => ({
        settings: context.activeCollectionId
          ? { collectionId: context.activeCollectionId }
          : undefined,
      }),
    },
    {
      id: "relative-valuation-pane",
      paneId: "relative-valuation",
      label: "Relative Valuation",
      description: "Compare valuation and operating metrics across peers.",
      keywords: ["relative", "valuation", "comps", "peers", "rv"],
      shortcut: { prefix: "RV", argPlaceholder: "tickers", argKind: "ticker-list" },
      canCreate: (context, options) => !!(options?.symbols?.length || options?.arg || context.activeTicker),
      createInstance: (context, options) => {
        let symbols: string[];
        try {
          symbols = options?.symbols?.length
            ? options.symbols
            : parseTickerListInput(options?.arg ?? context.activeTicker ?? "", 12);
        } catch {
          return null;
        }
        return {
          title: `RV ${formatTickerListInput(symbols)}`,
          placement: "floating",
          settings: { symbols, symbolsText: formatTickerListInput(symbols) },
        };
      },
    },
  ],
};
