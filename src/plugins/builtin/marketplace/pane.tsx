import { useEffect, useRef } from "react";
import { Tabs } from "../../../components";
import { Box } from "../../../ui";
import type { PaneProps } from "../../../types/plugin";
import { getSharedRegistry } from "../../registry";
import { usePluginAppActions, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { LayoutMarketplaceGallery } from "../../../layout-marketplace/gallery";
import { PluginMarketplacePane } from "../plugin-marketplace/pane";

type MarketplaceTab = "plugins" | "layouts";

const MARKETPLACE_TABS = [
  { label: "Plugins", value: "plugins" },
  { label: "Layouts", value: "layouts" },
];

export function MarketplacePane({ focused, width, height, ...paneProps }: PaneProps) {
  const [defaultTabId] = usePaneSettingValue<string>("defaultTabId", "plugins");
  const fallbackTab: MarketplaceTab = defaultTabId === "layouts" ? "layouts" : "plugins";
  const [activeTab, setActiveTab] = usePluginPaneState<MarketplaceTab>("activeTab", fallbackTab);
  const previousDefaultTabRef = useRef(defaultTabId);
  useEffect(() => {
    if (previousDefaultTabRef.current === defaultTabId) return;
    previousDefaultTabRef.current = defaultTabId;
    setActiveTab(fallbackTab);
  }, [defaultTabId, fallbackTab, setActiveTab]);
  const registry = getSharedRegistry();
  const { hidePane } = usePluginAppActions();
  const contentHeight = Math.max(1, height - 1);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Tabs
        tabs={MARKETPLACE_TABS}
        activeValue={activeTab}
        onSelect={(value) => setActiveTab(value as MarketplaceTab)}
        focused={focused}
      />
      <Box height={contentHeight} flexGrow={1} flexBasis={0} overflow="hidden">
        {activeTab === "plugins" ? (
          <PluginMarketplacePane
            {...paneProps}
            focused={focused}
            width={width}
            height={contentHeight}
          />
        ) : registry ? (
          <LayoutMarketplaceGallery
            pluginRegistry={registry}
            focused={focused}
            width={width}
            height={contentHeight}
            onClose={() => hidePane("marketplace")}
          />
        ) : null}
      </Box>
    </Box>
  );
}
