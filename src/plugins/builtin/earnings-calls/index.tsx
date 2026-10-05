import type { TickerResearchTabLoadContext } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { researchCanReadPro, shownIf } from "../shared/research-tab-availability";
import { attachEarningsCallsPersistence, loadEarningsCalls, resetEarningsCallsPersistence } from "./data";
import { CALL_PAGE_SIZE, EarningsCallsPane, EARNINGS_CALLS_PANE_ID } from "./pane";
import { earningsCallsHeadless } from "./headless";

function loadCallsTab({ symbol }: TickerResearchTabLoadContext): Promise<boolean> {
  if (!symbol || !researchCanReadPro()) return Promise.resolve(true);
  return shownIf(
    () => loadEarningsCalls(symbol.toUpperCase(), { limit: CALL_PAGE_SIZE }),
    (result) => result.calls.length > 0
      || result.pending === true
      || !!result.refreshError
      || result.errorStatus === 401
      || result.errorStatus === 402
      || result.errorStatus === 403,
  );
}


const description =
  "Earnings call transcripts with speaker attribution, analyst Q&A, and extracted guidance. Alone, every transcribed call; with a ticker, that company's calls.";

function explicitSymbol(options?: { arg?: string; symbol?: string | null }): string | null {
  const symbol = (options?.symbol ?? options?.arg ?? "").trim().toUpperCase();
  return symbol || null;
}

export const earningsCallsModule: PluginModule = {
  setup(ctx) {
    attachEarningsCallsPersistence(ctx.persistence);

    ctx.registerTickerResearchTab({
      id: "earnings-calls",
      name: "Calls",
      order: 34,
      component: EarningsCallsPane,
      instruments: ["equity"],
      load: loadCallsTab,
    });
  },

  dispose() {
    resetEarningsCallsPersistence();
  },

  panes: [
    {
      id: EARNINGS_CALLS_PANE_ID,
      name: "Earnings Calls",
      icon: "C",
      component: EarningsCallsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    {
      id: "earnings-calls-pane",
      paneId: EARNINGS_CALLS_PANE_ID,
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
        "ect",
      ],
      // The ticker is optional on purpose: CALLS alone browses every call,
      // and it must not silently bind to whatever ticker happens to be active.
      shortcut: { prefix: "CALLS", argPlaceholder: "ticker", argKind: "ticker", argOptional: true },
      headless: earningsCallsHeadless,
      createInstance: (_context, options) => {
        const symbol = explicitSymbol(options);
        if (!symbol) return { placement: "floating" };
        return {
          instanceId: `${EARNINGS_CALLS_PANE_ID}:${encodeURIComponent(symbol).replace(/%/g, "~")}`,
          title: `CALLS ${symbol}`,
          binding: { kind: "fixed", symbol },
          placement: "floating",
        };
      },
    },
  ],
};
