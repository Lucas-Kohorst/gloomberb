import { researchDataPlugins } from "./catalog-research";
import {
  attachFredSeriesPersistence,
  resetFredSeriesPersistence,
} from "../data/fred-series";
import type { GloomPlugin } from "../types/plugin";
import { portfolioAnalyticsModule } from "./builtin/analytics";
import { alertsPlugin } from "./builtin/alerts";
import { browserGloomberbCloudPlugin } from "./builtin/cloud/browser";
import { changelogModule } from "./builtin/changelog";
import { chartComposerModule } from "./builtin/chart-composer";
import { connectionsModule } from "./builtin/connections/index.ts";
import { adjacentPlugin } from "./builtin/adjacent";
import { researchSearchPlugin } from "./builtin/research-search";
import { correlationModule } from "./builtin/correlation";
import { cdsModule } from "./builtin/cds";
import { creditConditionsModule } from "./builtin/credit-conditions";
import { marketValuationModule } from "./builtin/market-valuation";
import {
  attachValuationPersistence,
  resetValuationPersistence,
} from "./builtin/market-valuation/cache";
import { economicCalendarModule } from "./builtin/econ";
import { econStatisticsModule } from "./builtin/econ-statistics";
import { equityScreenerModule } from "./builtin/equity-screener";
import { futuresCurveModule } from "./builtin/futures-curve";
import { futuresModule } from "./builtin/futures";
import { fxMatrixModule } from "./builtin/fx-matrix";
import { helpModule } from "./builtin/help";
import { ivHistoryModule } from "./builtin/iv-history";
import { positionSizerModule } from "./builtin/kelly-sizer";
import { layoutManagerModule } from "./builtin/layout-manager";
import { tickerNewsModule } from "./builtin/news";
import { mnaModule } from "./builtin/mna";
import { moneyMarketsModule } from "./builtin/money-markets";
import { optionsModule } from "./builtin/options";
import { optionsCalculatorModule } from "./builtin/options-calculator";
import { optionsPositioningModule } from "./builtin/options-positioning";
import { optionsScenarioModule } from "./builtin/options-scenario";
import { composeBuiltinPlugin, type PluginModule } from "./builtin/plugin-module";
import { portfolioListModule } from "./builtin/portfolio-list";
import { ratePathModule } from "./builtin/rate-path";
import { relativeRotationModule } from "./builtin/relative-rotation";
import { researchModule } from "./builtin/research";
import { seasonalityModule } from "./builtin/seasonality";
import { socialMentionsModule } from "./builtin/social-mentions";
import { scannerModule } from "./builtin/scanner";
import { sectorsModule } from "./builtin/sectors";
import { executivesModule } from "./builtin/executives";
import { tickerDetailModule } from "./builtin/ticker-detail";
import { treasuryAuctionsModule } from "./builtin/treasury-auctions";
import { volatilityModule } from "./builtin/volatility";
import { worldIndicesModule } from "./builtin/world-indices";
import { worldVenueMapModule } from "./builtin/world-venue-map";
import { yieldCurveModule } from "./builtin/yield-curve";
import { notificationCenterPlugin } from "./builtin/notification-center";
import { attentionModule } from "./builtin/attention";
import { awardsModule } from "./builtin/awards";
import { backtestModule } from "./builtin/backtest";
import { bondCalculatorModule } from "./builtin/bond-calculator";
import { catalystsModule } from "./builtin/catalysts";
import { centralBankRatesModule } from "./builtin/central-bank-rates";
import { companyAttentionModule } from "./builtin/company-attention";
import { companyKpisModule } from "./builtin/company-kpis";
import { cotModule } from "./builtin/cot";
import { cpiModule } from "./builtin/cpi";
import { creditBoardsModule } from "./builtin/credit-boards";
import { creditDocumentsModule } from "./builtin/credit-documents";
import { cryptoBoardModule } from "./builtin/crypto-board";
import { debtMaturitiesModule } from "./builtin/debt-maturities";
import { doeModule } from "./builtin/doe";
import { earningsRippleModule } from "./builtin/earnings-ripple";
import { estimateRevisionsModule } from "./builtin/estimate-revisions";
import { exposureModule } from "./builtin/exposure";
import { filingEventsModule } from "./builtin/filing-events";
import { gpuModule } from "./builtin/gpu";
import { jobsModule } from "./builtin/jobs";
import { macroDayModule } from "./builtin/macro-day";
import { perpsModule } from "./builtin/perps";
import { powerModule } from "./builtin/power";
import { realizedVolModule } from "./builtin/realized-vol";
import { revenueBreakdownModule } from "./builtin/revenue-breakdown";
import { reverseDcfModule } from "./builtin/reverse-dcf";
import { riskFactorsModule } from "./builtin/risk-factors";
import { shortVolumeModule } from "./builtin/short-volume";
import { supplyChainModule } from "./builtin/supply-chain";
import { timeSalesModule } from "./builtin/time-sales";
import { volSurfaceModule } from "./builtin/vol-surface";

const browserApplicationPlugin = composeBuiltinPlugin({
  id: "application",
  name: "Application",
  version: "1.0.0",
  description: "Core layout, help, and release information.",
  modules: [layoutManagerModule, helpModule, changelogModule, connectionsModule],
});

const browserPortfolioPlugin = composeBuiltinPlugin({
  id: "portfolio",
  name: "Portfolio",
  version: "1.0.0",
  description: "Portfolio and watchlist management, analytics, and position sizing.",
  toggleable: true,
  modules: [portfolioListModule, portfolioAnalyticsModule, positionSizerModule],
});

const browserTickerResearchPlugin = composeBuiltinPlugin({
  id: "ticker-research",
  name: "Ticker Research",
  version: "1.0.0",
  description: "Company overview, charts, financials, options, and research.",
  toggleable: true,
  modules: [
    tickerDetailModule,
    chartComposerModule,
    optionsModule,
    optionsCalculatorModule,
    optionsPositioningModule,
    optionsScenarioModule,
    researchModule,
    executivesModule,
    seasonalityModule,
    ivHistoryModule,
    socialMentionsModule,
    mnaModule,
    volSurfaceModule,
    realizedVolModule,
    earningsRippleModule,
    reverseDcfModule,
    macroDayModule,
    backtestModule,
    timeSalesModule,
    estimateRevisionsModule,
    shortVolumeModule,
    debtMaturitiesModule,
    revenueBreakdownModule,
    supplyChainModule,
    creditDocumentsModule,
    companyAttentionModule,
    catalystsModule,
    companyKpisModule,
    awardsModule,
    exposureModule,
    riskFactorsModule,
    filingEventsModule,
    jobsModule,
  ],
});

const browserNewsPlugin = composeBuiltinPlugin({
  id: "news",
  name: "News",
  version: "1.0.0",
  description: "View latest news for each ticker.",
  toggleable: true,
  modules: [tickerNewsModule],
});

const browserMarketOverviewPlugin = composeBuiltinPlugin({
  id: "market-overview",
  name: "Market Overview",
  version: "1.0.0",
  description: "Global indices, scanners, sectors, FX, futures, and correlations.",
  toggleable: true,
  modules: [
    correlationModule,
    relativeRotationModule,
    worldIndicesModule,
    worldVenueMapModule,
    scannerModule,
    sectorsModule,
    fxMatrixModule,
    futuresModule,
    futuresCurveModule,
    equityScreenerModule,
    cotModule,
    doeModule,
    gpuModule,
    attentionModule,
    powerModule,
    cryptoBoardModule,
    perpsModule,
  ],
});

const browserFredResourcesModule: PluginModule = {
  setup(ctx) {
    attachFredSeriesPersistence(ctx.persistence);
    attachValuationPersistence(ctx.persistence);
  },
  dispose() {
    resetFredSeriesPersistence();
    resetValuationPersistence();
  },
};

const browserMacroPlugin = composeBuiltinPlugin({
  id: "macro",
  name: "Macro",
  version: "1.0.0",
  description: "Economic calendar, rates, volatility, credit spreads, single-name CDS, and Treasury auctions.",
  toggleable: true,
  modules: [
    browserFredResourcesModule,
    economicCalendarModule,
    econStatisticsModule,
    yieldCurveModule,
    ratePathModule,
    moneyMarketsModule,
    volatilityModule,
    creditConditionsModule,
    marketValuationModule,
    cdsModule,
    treasuryAuctionsModule,
    cpiModule,
    bondCalculatorModule,
    centralBankRatesModule,
    creditBoardsModule,
  ],
});

/**
 * Reviewed browser catalog. Native brokers, filesystem/local-process plugins,
 * and modules whose data path is not available through Gloom Cloud or a
 * browser-safe public API are absent rather than registered behind stubs.
 */
export const browserBuiltinPlugins: readonly GloomPlugin[] = [
  ...researchDataPlugins,
  browserGloomberbCloudPlugin,
  browserPortfolioPlugin,
  browserTickerResearchPlugin,
  browserApplicationPlugin,
  browserNewsPlugin,
  browserMarketOverviewPlugin,
  browserMacroPlugin,
  notificationCenterPlugin,
  alertsPlugin,
  adjacentPlugin,
  researchSearchPlugin,
];

export function getBrowserBuiltinPlugins(): readonly GloomPlugin[] {
  return browserBuiltinPlugins;
}
