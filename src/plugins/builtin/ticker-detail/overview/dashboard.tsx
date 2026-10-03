import { OverviewTab } from "../overview-tab";
import { useState } from "react";
import { Box, ScrollBox, Text } from "../../../../ui";
import { Button } from "../../../../components/ui/button";
import { PaneFooterScope } from "../../../../components";
import { useAppSelector, usePaneInstance, usePaneTicker } from "../../../../state/app/context";
import { getSharedRegistry } from "../../../registry";
import { colors } from "../../../../theme/colors";
import type { TickerResearchTabProps } from "../../../../types/plugin";
import { getTickerResearchPaneSettings } from "../settings";
import { OVERVIEW_PANEL_OPTIONS, overviewPanels } from "./layout";

const ignoreCapture = () => {};

export function OverviewDashboard({ width, height, focused, onCapture }: TickerResearchTabProps) {
  const instance = usePaneInstance();
  const { ticker, financials } = usePaneTicker();
  const config = useAppSelector((state) => state.config);
  const settings = getTickerResearchPaneSettings(instance?.settings);
  const [selectedPanel, setSelectedPanel] = useState<string | null>(null);
  const registry = getSharedRegistry();
  const panels = overviewPanels(settings.overviewPreset, settings.overviewPanels);
  const activePanel = panels.includes(selectedPanel as typeof panels[number]) ? selectedPanel : panels[0];
  const columns = width >= 90 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(panels.length / columns));
  const panelWidth = Math.max(1, (width - (columns - 1)) / columns);
  const panelHeight = Math.max(10, (height - (rows - 1)) / rows);
  return (
    <ScrollBox flexGrow={1} flexBasis={0} scrollY focusable={false}>
      {panels.length === 0 && <Text fg={colors.textDim}>Choose panels in Ticker Research settings.</Text>}
      {Array.from({ length: rows }, (_, row) => (
        <Box key={row} flexDirection="row" height={panelHeight} gap={1} flexShrink={0}>
          {panels.slice(row * columns, (row + 1) * columns).map((id) => {
            const tab = id === "buzz" ? undefined : registry?.tickerResearchTabs.get(id);
            const pane = id === "buzz" ? registry?.panes.get("social-mentions") : undefined;
            const owner = tab ? registry?.getTickerResearchTabPluginId?.(tab.id) : undefined;
            const available = tab && (!owner || !config.disabledPlugins.includes(owner))
              && (!tab.isVisible || tab.isVisible({ ticker, financials, config, hasOptionsChain: false }));
            const ResearchTab = available ? tab.component : undefined;
            const paneOwner = pane ? registry?.getPanePluginId(pane.id) : undefined;
            const BuzzPane = !paneOwner || !config.disabledPlugins.includes(paneOwner) ? pane?.component : undefined;
            const active = focused && activePanel === id;
            const label = OVERVIEW_PANEL_OPTIONS.find((option) => option.value === id)!.label;
            return (
              <Box key={id} width={panelWidth} height={panelHeight} flexDirection="column" overflow="hidden">
                <Box height={1} flexShrink={0}>
                  <Button label={label} variant="ghost" active={active} onPress={() => { onCapture(false); setSelectedPanel(id); }} />
                </Box>
                <PaneFooterScope active={active}>
                  {id === "snapshot" ? <OverviewTab width={panelWidth} ticker={ticker} financials={financials} />
                    : ResearchTab ? <ResearchTab width={panelWidth} height={panelHeight - 1} focused={active} onCapture={active ? onCapture : ignoreCapture} />
                    : BuzzPane ? <BuzzPane paneId={instance?.instanceId ?? ""} paneType="social-mentions"
                      width={panelWidth} height={panelHeight - 1} focused={active} />
                      : <Text fg={colors.textDim}>{label} is unavailable for this instrument.</Text>}
                </PaneFooterScope>
              </Box>
            );
          })}
        </Box>
      ))}
    </ScrollBox>
  );
}
