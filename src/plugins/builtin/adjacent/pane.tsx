import { PaneListChrome } from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import { usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { AdjacentIndicesPane } from "./indices";
import { AdjacentRatesPane } from "./rates";
import { AdjacentMarketsPane } from "./markets";
import { AdjacentFilingsPane } from "./filings";
import type { AdjacentClient } from "./client";

type AdjacentTab = "indices" | "rates" | "markets" | "cftc";

const ADJACENT_TABS = [
  { label: "Indices", value: "indices" },
  { label: "Rates", value: "rates" },
  { label: "Markets", value: "markets" },
  { label: "CFTC", value: "cftc" },
];

function adjacentTabFromSetting(value: string): AdjacentTab {
  if (value === "rates" || value === "markets" || value === "cftc") return value;
  return "indices";
}

export function AdjacentPane({
  width,
  height,
  focused,
  client,
  ...rest
}: PaneProps & { client: AdjacentClient }) {
  const [defaultTabId] = usePaneSettingValue<string>("defaultTabId", "indices");
  const fallback = adjacentTabFromSetting(defaultTabId);
  const [activeTab, setActiveTab] = usePluginPaneState<AdjacentTab>("activeTab", fallback);

  return (
    <PaneListChrome
      width={width}
      height={height}
      focused={focused}
      tabs={ADJACENT_TABS}
      activeValue={activeTab}
      onSelect={(value) => setActiveTab(value as AdjacentTab)}
    >
      {activeTab === "indices" && (
        <AdjacentIndicesPane client={client} width={width} height={Math.max(1, height - 1)} focused={focused} {...rest} />
      )}
      {activeTab === "rates" && (
        <AdjacentRatesPane client={client} width={width} height={Math.max(1, height - 1)} focused={focused} {...rest} />
      )}
      {activeTab === "markets" && (
        <AdjacentMarketsPane client={client} width={width} height={Math.max(1, height - 1)} focused={focused} {...rest} />
      )}
      {activeTab === "cftc" && (
        <AdjacentFilingsPane client={client} width={width} height={Math.max(1, height - 1)} focused={focused} {...rest} />
      )}
    </PaneListChrome>
  );
}
