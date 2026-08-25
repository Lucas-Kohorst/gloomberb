import { FRED_PUBLIC_CONNECTION_ID } from "../../data/fred-public";
import {
  attachFredSeriesPersistence,
  resetFredSeriesPersistence,
} from "../../data/fred-series";
import { registerConnectionSource } from "./connections/register";
import { portfolioAnalyticsModule } from "./analytics";
import { brokerManagerModule } from "./broker-manager";
import { byokModule } from "./byok";
import { changelogModule } from "./changelog";
import { connectionsModule } from "./connections";
import { correlationModule } from "./correlation";
import { bondSearchModule } from "./bond-search";
import { cdsModule } from "./cds";
import { creditConditionsModule } from "./credit-conditions";
import { economicCalendarModule } from "./econ";
import { countryEconModule } from "./country-econ";
import { earningsModule } from "./earnings";
import { fearGreedModule } from "./fear-greed";
import { futuresModule } from "./futures";
import { commoditiesModule } from "./commodities";
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
import { paneCsvModule } from "./shared/pane-csv-module";
import { portfolioListModule } from "./portfolio-list";
import { scannerModule } from "./scanner";
import { screenerModule } from "./screener";
import { sectorsModule } from "./sectors";
import { treasuryAuctionsModule } from "./treasury-auctions";
import { volatilityModule } from "./volatility";
import { worldIndicesModule } from "./world-indices";
import { yieldCurveModule } from "./yield-curve";

let disposeFredPublic: (() => void) | null = null;

const macroSharedResourcesModule = {
  setup(ctx) {
    attachFredSeriesPersistence(ctx.persistence);
    disposeFredPublic = registerConnectionSource({
      id: FRED_PUBLIC_CONNECTION_ID,
      name: "FRED",
      kind: "api",
      pluginId: "macro",
      authRequired: false,
    });
  },
  dispose() {
    disposeFredPublic?.();
    disposeFredPublic = null;
    resetFredSeriesPersistence();
  },
} satisfies PluginModule;

export const applicationPlugin = composeBuiltinPlugin({
  id: "application",
  name: "Application",
  version: "1.0.0",
  description: "Core layout, help, release information, API key management, and connection health.",
  modules: [layoutManagerModule, helpModule, changelogModule, byokModule, connectionsModule, paneCsvModule],
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
  description: "Global indices, futures, commodities, movers, scanners, sectors, FX, sentiment, and correlations.",
  toggleable: true,
  modules: [
    correlationModule,
    worldIndicesModule,
    futuresModule,
    commoditiesModule,
    marketHeatmapModule,
    marketMoversModule,
    marketHaltsModule,
    scannerModule,
    screenerModule,
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
    "Economic calendar, country/regional World Bank series, yield curve, volatility, credit spreads, single-name CDS, Treasury auctions, bond yields, earnings, IPOs, and live financial TV.",
  toggleable: true,
  modules: [
    macroSharedResourcesModule,
    economicCalendarModule,
    countryEconModule,
    yieldCurveModule,
    volatilityModule,
    creditConditionsModule,
    cdsModule,
    treasuryAuctionsModule,
    bondSearchModule,
    earningsModule,
    ipoCalendarModule,
    tvModule,
  ],
});
