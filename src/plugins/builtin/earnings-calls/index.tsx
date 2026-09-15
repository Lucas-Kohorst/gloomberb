import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { attachEarningsCallsPersistence, resetEarningsCallsPersistence } from "./data";
import { EarningsCallsPane, EARNINGS_CALLS_PANE_ID } from "./pane";

const description =
  "Earnings call transcripts with speaker attribution, analyst Q&A, and extracted guidance.";

export const earningsCallsModule: PluginModule = {
  setup(ctx) {
    attachEarningsCallsPersistence(ctx.persistence);

    ctx.registerTickerResearchTab({
      id: "earnings-calls",
      name: "Calls",
      order: 34,
      component: EarningsCallsPane,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
  },

  dispose() {
    resetEarningsCallsPersistence();
  },

  paneTemplates: [
    // Browse every transcribed call, unbound to a ticker.
    {
      id: "earnings-calls-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Earnings Calls",
      description,
      keywords: [
        "earnings",
        "call",
        "calls",
        "transcript",
        "transcripts",
        "conference",
        "guidance",
        "qa",
      ],
      shortcut: { prefix: "CALLS" },
      createInstance: () => ({
        placement: "floating",
        settings: { defaultTabId: "earnings-calls" },
      }),
    },
    createTickerSurfacePaneTemplate({
      id: "earnings-call-transcripts-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Earnings Call Transcripts",
      description,
      keywords: ["earnings", "call", "transcript", "ect", "qa", "guidance"],
      shortcut: "ECT",
      publicShare: false,
      settings: () => ({ defaultTabId: "earnings-calls" }),
    }),
  ],
};
