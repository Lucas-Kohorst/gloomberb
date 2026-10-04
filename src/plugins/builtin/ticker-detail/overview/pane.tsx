import type { TickerResearchTabProps } from "../../../../types/plugin";
import { usePaneTicker } from "../../../../state/app/context";
import { stubSummaryFromTicker } from "../../../prediction-markets/collection-watchlist";
import { OverviewTab } from "../overview-tab";
import { PredictionResearchOverview } from "../prediction-overview";

export function OverviewResearchTab({ width, height, focused }: TickerResearchTabProps) {
  const { ticker, financials } = usePaneTicker();
  if (ticker && stubSummaryFromTicker(ticker)) {
    return <PredictionResearchOverview width={width} focused={focused} />;
  }
  return (
    <OverviewTab
      width={width}
      ticker={ticker}
      financials={financials}
    />
  );
}
