import type { GloomPlugin } from "../types/plugin";
import type { LoadedExternalPlugin } from "./loader";
import { newsPlugin } from "./builtin/news";
import { notesPlugin } from "./builtin/notes";
import { customViewPlugin } from "./builtin/custom-view";
import { gloomberbCloudPlugin } from "./builtin/cloud";
import { alertsPlugin } from "./builtin/alerts";
import { researchSearchPlugin } from "./builtin/research-search";
import { marketHeatmapPlugin } from "./builtin/market-heatmap";
import { marketHaltsPlugin } from "./builtin/market-halts";
import { fearGreedPlugin } from "./builtin/fear-greed";
import { membersPlugin } from "./builtin/members";
import { ipoCalendarPlugin } from "./builtin/ipo-calendar";
import { clinicalTrialsPlugin } from "./builtin/clinical-trials";
import { commentLettersPlugin } from "./builtin/comment-letters";
import { openFdaPlugin } from "./builtin/openfda";
import { bankFinancialsPlugin } from "./builtin/bank-financials";
import { canadaListingsPlugin } from "./builtin/canada-listings";
import { commodityBalancesPlugin } from "./builtin/commodity-balances";
import { congressBillsPlugin } from "./builtin/congress-bills";
import { deribitPlugin } from "./builtin/deribit";
import { energyOutlookPlugin } from "./builtin/energy-outlook";
import { failsToDeliverPlugin } from "./builtin/fails-to-deliver";
import { famaFrenchPlugin } from "./builtin/fama-french";
import { fundPortfolioPlugin } from "./builtin/fund-portfolio";
import { jodiPlugin } from "./builtin/jodi";
import { loanSurveyPlugin } from "./builtin/loan-survey";
import { nordicRatesPlugin } from "./builtin/nordic-rates";
import { nowcastsPlugin } from "./builtin/nowcasts";
import { payPerformancePlugin } from "./builtin/pay-performance";
import { portwatchPlugin } from "./builtin/portwatch";
import { primaryDealersPlugin } from "./builtin/primary-dealers";
import { traceBondsPlugin } from "./builtin/trace-bonds";
import { treasuryDailyPlugin } from "./builtin/treasury-daily";
import {
  applicationPlugin,
  brokerPlugin,
  macroPlugin,
  marketOverviewPlugin,
  portfolioPlugin,
  tickerResearchPlugin,
} from "./builtin/composite-plugins";

export const uiBuiltinPlugins: GloomPlugin[] = [
  gloomberbCloudPlugin,
  portfolioPlugin,
  tickerResearchPlugin,
  brokerPlugin,
  applicationPlugin,
  newsPlugin,
  notesPlugin,
  customViewPlugin,
  marketOverviewPlugin,
  marketHeatmapPlugin,
  marketHaltsPlugin,
  fearGreedPlugin,
  membersPlugin,
  ipoCalendarPlugin,
  clinicalTrialsPlugin,
  commentLettersPlugin,
  openFdaPlugin,
  bankFinancialsPlugin,
  canadaListingsPlugin,
  commodityBalancesPlugin,
  congressBillsPlugin,
  deribitPlugin,
  energyOutlookPlugin,
  failsToDeliverPlugin,
  famaFrenchPlugin,
  fundPortfolioPlugin,
  jodiPlugin,
  loanSurveyPlugin,
  nordicRatesPlugin,
  nowcastsPlugin,
  payPerformancePlugin,
  portwatchPlugin,
  primaryDealersPlugin,
  traceBondsPlugin,
  treasuryDailyPlugin,
  macroPlugin,
  alertsPlugin,
  researchSearchPlugin,
];

/**
 * The plugin list for a UI renderer: the built-ins it ships with, plus any
 * external plugins that loaded and support this renderer.
 *
 * Deliberately not `getLoadablePlugins`, which is the CLI catalog and also
 * carries the debug plugin. Routing the desktop
 * through it would quietly change which plugins the app runs.
 */
export function getRendererPlugins(externalPlugins: readonly LoadedExternalPlugin[] = []): GloomPlugin[] {
  return [
    ...uiBuiltinPlugins,
    ...externalPlugins
      .filter((entry) => !entry.error && !entry.unsupportedTarget && !entry.needsRestart)
      .map((entry) => entry.plugin),
  ];
}
