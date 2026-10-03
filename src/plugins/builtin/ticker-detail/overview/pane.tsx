import { SelectButton } from "../../../../components/ui/select-button";
import { OVERVIEW_PRESET_OPTIONS, type OverviewPreset } from "./layout";
import { Box, useUiCapabilities } from "../../../../ui";
import { getTickerResearchPaneSettings } from "../settings";
import { OverviewDashboard } from "./dashboard";
import type { TickerResearchTabProps } from "../../../../types/plugin";
import { usePaneInstance, usePaneSettingValue, usePaneTicker } from "../../../../state/app/context";
import { stubSummaryFromTicker } from "../../../prediction-markets/collection-watchlist";
import { OverviewTab } from "../overview-tab";
import { PredictionResearchOverview } from "../prediction-overview";

export function OverviewResearchTab({ width, height, focused, onCapture }: TickerResearchTabProps) {
  const { fractionalViewport = false } = useUiCapabilities();
  const instance = usePaneInstance();
  const settings = getTickerResearchPaneSettings(instance?.settings);
  const [, setPreset] = usePaneSettingValue<OverviewPreset>("overviewPreset", "classic");
  const { ticker, financials } = usePaneTicker();
  if (ticker && stubSummaryFromTicker(ticker)) {
    return <PredictionResearchOverview width={width} focused={focused} />;
  }
  if (fractionalViewport && ticker) {
    return (
      <Box flexDirection="column" flexGrow={1} flexBasis={0} overflow="hidden">
        <Box height={2} flexShrink={0}>
          <SelectButton label="Layout" value={settings.overviewPreset} options={OVERVIEW_PRESET_OPTIONS}
            onChange={(preset) => { onCapture(false); setPreset(preset); }} />
        </Box>
        {settings.overviewPreset === "classic"
          ? <OverviewTab width={width} ticker={ticker} financials={financials} />
          : <OverviewDashboard width={width} height={Math.max(1, height - 2)} focused={focused} onCapture={onCapture} />}
      </Box>
    );
  }
  return (
    <OverviewTab
      width={width}
      ticker={ticker}
      financials={financials}
    />
  );
}
