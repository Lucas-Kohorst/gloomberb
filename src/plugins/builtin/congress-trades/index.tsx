import { EmptyState } from "../../../components";
import type { TickerResearchTabLoadContext, TickerResearchTabProps } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { shownIf } from "../shared/research-tab-availability";
import { loadCongressHouse } from "./client";
import { CONGRESS_FILING_LIMIT, CONGRESS_TRADE_LIMIT } from "./model";
import { CongressTradesPane } from "./pane";
import { isKnownNonUsListing } from "../../../utils/sec";
import { usePaneTickerIdentity } from "../../../state/hooks/pane-ticker";

function loadCongressTab({ ticker, signal }: TickerResearchTabLoadContext): Promise<boolean> {
  return shownIf(
    () => loadCongressHouse({
      chamber: "all",
      limit: CONGRESS_TRADE_LIMIT,
      filingLimit: CONGRESS_FILING_LIMIT,
      refresh: false,
      ticker: ticker.metadata.ticker,
    }, undefined, signal),
    (payload) => payload.trades.length > 0,
  );
}

function CongressTickerTab(props: TickerResearchTabProps) {
  const { ticker } = usePaneTickerIdentity();
  const symbol = ticker?.metadata.ticker;
  if (!symbol) return <EmptyState title="Select a ticker." />;
  return <CongressTradesPane key={symbol} {...props} paneId="congress" paneType="congress-trades" tickerFilter={symbol} />;
}

export const congressResearchModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "congress",
      name: "Congress",
      order: 38,
      component: CongressTickerTab,
      instruments: ["equity", "fund"],
      isVisible: ({ ticker }) => !isKnownNonUsListing(ticker),
      load: loadCongressTab,
    });
  },
};
