import {
  attachFredSeriesPersistence,
  resetFredSeriesPersistence,
} from "../../data/fred-series";
import { portfolioAnalyticsModule } from "./analytics";
import { brokerManagerModule } from "./broker-manager";
import { byokModule } from "./byok";
import { changelogModule } from "./changelog";
import { connectionsModule } from "./connections";
import { correlationModule } from "./correlation";
import { bondSearchModule } from "./bond-search";
import { creditConditionsModule } from "./credit-conditions";
import { economicCalendarModule } from "./econ";
import { earningsModule } from "./earnings";
import { fearGreedModule } from "./fear-greed";
import { futuresModule } from "./futures";
import { fxMatrixModule } from "./fx-matrix";
import { helpModule } from "./help";
import { ipoCalendarModule } from "./ipo-calendar";
import { positionSizerModule } from "./kelly-sizer";
import { layoutManagerModule } from "./layout-manager";
import { marketHaltsModule } from "./market-halts";
import { marketHeatmapModule } from "./market-heatmap";
import { marketMoversModule } from "./market-movers";
import { optionsCalcModule } from "./options-calc";
import { tvModule } from "./tv";
import { composeBuiltinPlugin, type PluginModule } from "./plugin-module";
import { portfolioListModule } from "./portfolio-list";
import { scannerModule } from "./scanner";
import { sectorsModule } from "./sectors";
import { treasuryAuctionsModule } from "./treasury-auctions";
import { volatilityModule } from "./volatility";
import { worldIndicesModule } from "./world-indices";
import { yieldCurveModule } from "./yield-curve";

const macroSharedResourcesModule = {
  setup(ctx) {
    attachFredSeriesPersistence(ctx.persistence);
  },
  dispose() {
    resetFredSeriesPersistence();
  },
} satisfies PluginModule;

export const applicationPlugin = composeBuiltinPlugin({
  id: "application",
  name: "Application",
  version: "1.0.0",
  description: "Core layout, help, release information, API key management, and connection health.",
  modules: [layoutManagerModule, helpModule, changelogModule, byokModule, connectionsModule],
});

export const portfolioPlugin = composeBuiltinPlugin({
  id: "portfolio",
  name: "Portfolio",
  version: "1.0.0",
  description: "Portfolio and watchlist management, analytics, and position sizing.",
  toggleable: true,
  modules: [portfolioListModule, portfolioAnalyticsModule, positionSizerModule, optionsCalcModule],
});

export const brokerPlugin = composeBuiltinPlugin({
  id: "broker",
  name: "Broker",
  version: "1.0.0",
  description: "Broker profiles, account sync, and connection status.",
  toggleable: true,
  modules: [brokerManagerModule],
});

export const marketOverviewPlugin = composeBuiltinPlugin({
  id: "market-overview",
  name: "Market Overview",
  version: "1.0.0",
  description: "Global indices, futures, movers, scanners, sectors, FX, sentiment, and correlations.",
  toggleable: true,
  modules: [
    correlationModule,
    worldIndicesModule,
    futuresModule,
    marketHeatmapModule,
    marketMoversModule,
    marketHaltsModule,
    scannerModule,
    fearGreedModule,
    sectorsModule,
    fxMatrixModule,
  ],
});

export const macroPlugin = composeBuiltinPlugin({
  id: "macro",
  name: "Macro",
  version: "1.0.0",
  description:
    "Economic calendar, yield curve, volatility, credit spreads, Treasury auctions, bond yields, earnings, IPOs, and live financial TV.",
  toggleable: true,
  modules: [
    macroSharedResourcesModule,
    economicCalendarModule,
    yieldCurveModule,
    volatilityModule,
    creditConditionsModule,
    treasuryAuctionsModule,
    bondSearchModule,
    earningsModule,
    ipoCalendarModule,
    tvModule,
  ],
});
