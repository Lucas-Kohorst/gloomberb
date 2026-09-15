import { Box } from "../../../ui";
import { Tabs } from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import { usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { AdjacentIndicesPane } from "./indices";
import { AdjacentRatesPane } from "./rates";
import { AdjacentFilingsPane } from "./filings";
import type { AdjacentClient } from "./client";

type AdjacentTab = "indices" | "rates" | "cftc";

const ADJACENT_TABS = [
  { label: "Indices", value: "indices" },
  { label: "Rates", value: "rates" },
  { label: "CFTC", value: "cftc" },
];

export function AdjacentPane({
  width,
  height,
  focused,
  client,
  ...rest
}: PaneProps & { client: AdjacentClient }) {
  const [defaultTabId] = usePaneSettingValue<string>("defaultTabId", "indices");
  const fallback = (defaultTabId === "rates" || defaultTabId === "cftc") ? defaultTabId : "indices";
  const [activeTab, setActiveTab] = usePluginPaneState<AdjacentTab>("activeTab", fallback);
  const tabBarHeight = 1;
  const contentHeight = Math.max(1, height - tabBarHeight);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={tabBarHeight}>
        <Tabs
          tabs={ADJACENT_TABS}
          activeValue={activeTab}
          onSelect={(value) => setActiveTab(value as AdjacentTab)}
          focused={focused}
        />
      </Box>
      <Box height={contentHeight} flexGrow={1} flexBasis={0} overflow="hidden">
        {activeTab === "indices" && (
          <AdjacentIndicesPane client={client} width={width} height={contentHeight} focused={focused} {...rest} />
        )}
        {activeTab === "rates" && (
          <AdjacentRatesPane client={client} width={width} height={contentHeight} focused={focused} {...rest} />
        )}
        {activeTab === "cftc" && (
          <AdjacentFilingsPane client={client} width={width} height={contentHeight} focused={focused} {...rest} />
        )}
      </Box>
    </Box>
  );
}
