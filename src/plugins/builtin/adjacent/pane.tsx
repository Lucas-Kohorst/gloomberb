import { PaneListChrome } from "../../../components";
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
      {activeTab === "cftc" && (
        <AdjacentFilingsPane client={client} width={width} height={Math.max(1, height - 1)} focused={focused} {...rest} />
      )}
    </PaneListChrome>
  );
}
