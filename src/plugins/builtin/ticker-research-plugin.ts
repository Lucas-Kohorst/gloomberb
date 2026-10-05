import { assetsUnderManagementModule } from "./assets-under-management";
import { cashFlowModule } from "./cash-flow";
import { chartComposerModule } from "./chart-composer";
import { defillamaModule } from "./defillama";
import { dividendYieldModule } from "./dividend-yield";
import { earningsTranscriptsModule } from "./earnings-transcripts";
import { esgModule } from "./esg";
import { executivesModule } from "./executives";
import { holdersModule } from "./holders";
import { insiderModule } from "./insider";
import { ivHistoryModule } from "./iv-history";
import { mnaModule } from "./mna";
import { momentumSortinoModule } from "./momentum";
import { optionsModule } from "./options";
import { optionsCalculatorModule } from "./options-calculator";
import { optionsPositioningModule } from "./options-positioning";
import { optionsScenarioModule } from "./options-scenario";
import { patternRecognitionModule } from "./patterns";
import { composeBuiltinPlugin } from "./plugin-module";
import { researchModule } from "./research";
import { secModule } from "./sec";
import { seasonalityModule } from "./seasonality";
import { shortInterestModule } from "./short-interest";
import { socialMentionsModule } from "./social-mentions";
import { technicalSummaryModule } from "./technical-summary";
import { thirteenFModule } from "./thirteenf";
import { tickerDetailModule } from "./ticker-detail";
import { trendAnalysisModule } from "./trend-analysis";
import { awardsModule } from "./awards";
import { backtestModule } from "./backtest";
import { catalystsModule } from "./catalysts";
import { companyAttentionModule } from "./company-attention";
import { companyKpisModule } from "./company-kpis";
import { creditDocumentsModule } from "./credit-documents";
import { debtMaturitiesModule } from "./debt-maturities";
import { earningsRippleModule } from "./earnings-ripple";
import { estimateRevisionsModule } from "./estimate-revisions";
import { exposureModule } from "./exposure";
import { filingEventsModule } from "./filing-events";
import { jobsModule } from "./jobs";
import { macroDayModule } from "./macro-day";
import { realizedVolModule } from "./realized-vol";
import { revenueBreakdownModule } from "./revenue-breakdown";
import { reverseDcfModule } from "./reverse-dcf";
import { riskFactorsModule } from "./risk-factors";
import { shortVolumeModule } from "./short-volume";
import { supplyChainModule } from "./supply-chain";
import { timeSalesModule } from "./time-sales";
import { volSurfaceModule } from "./vol-surface";

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
    optionsPositioningModule,
    optionsScenarioModule,
    researchModule,
    cashFlowModule,
    executivesModule,
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
