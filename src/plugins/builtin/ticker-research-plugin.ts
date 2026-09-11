import { assetsUnderManagementModule } from "./assets-under-management";
import { cashFlowModule } from "./cash-flow";
import { chartComposerModule } from "./chart-composer";
import { defillamaModule } from "./defillama";
import { dividendYieldModule } from "./dividend-yield";
import { earningsTranscriptsModule } from "./earnings-transcripts";
import { esgModule } from "./esg";
import { holdersModule } from "./holders";
import { insiderModule } from "./insider";
import { momentumSortinoModule } from "./momentum";
import { optionsModule } from "./options";
import { optionsCalculatorModule } from "./options-calculator";
import { patternRecognitionModule } from "./patterns";
import { composeBuiltinPlugin } from "./plugin-module";
import { researchModule } from "./research";
import { secModule } from "./sec";
import { shortInterestModule } from "./short-interest";
import { technicalSummaryModule } from "./technical-summary";
import { thirteenFModule } from "./thirteenf";
import { tickerDetailModule } from "./ticker-detail";
import { trendAnalysisModule } from "./trend-analysis";

export const tickerResearchPlugin = composeBuiltinPlugin({
  id: "ticker-research",
  name: "Ticker Research",
  version: "1.0.0",
  description: "Company research workspace: overview, charts, financials, filings, ownership, options, analyst research, and events.",
  toggleable: true,
  modules: [
    tickerDetailModule,
    chartComposerModule,
    defillamaModule,
    optionsModule,
    optionsCalculatorModule,
    researchModule,
    cashFlowModule,
    dividendYieldModule,
    holdersModule,
    shortInterestModule,
    thirteenFModule,
    secModule,
    earningsTranscriptsModule,
    insiderModule,
    esgModule,
    assetsUnderManagementModule,
    patternRecognitionModule,
    trendAnalysisModule,
    technicalSummaryModule,
    momentumSortinoModule,
  ],
});
