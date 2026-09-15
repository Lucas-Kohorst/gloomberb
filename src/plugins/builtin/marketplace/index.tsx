import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { PLUGIN_REGISTRY_CONNECTION_ID } from "../plugin-marketplace/feed";
import { MarketplacePane } from "./pane";

export const MARKETPLACE_PANE_ID = "marketplace";
export const MARKETPLACE_TEMPLATE_ID = "marketplace-pane";

export function openMarketplaceTab(
  registry: { createPaneFromTemplate: (templateId: string, options?: { values?: Record<string, string> }) => void },
  tab: "plugins" | "layouts",
): void {
  registry.createPaneFromTemplate(MARKETPLACE_TEMPLATE_ID, { values: { tab } });
}

let disposeRegistryConnection: (() => void) | null = null;

export const marketplaceModule: PluginModule = {
  panes: [
    {
      id: MARKETPLACE_PANE_ID,
      name: "Marketplace",
      icon: "M",
      component: MarketplacePane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 118, height: 34 },
    },
  ],
  paneTemplates: [
    {
      id: MARKETPLACE_TEMPLATE_ID,
      paneId: MARKETPLACE_PANE_ID,
      label: "Marketplace",
      description: "Browse and manage plugins and shared layouts.",
      keywords: [
        "marketplace",
        "market",
        "plugins",
        "plugin",
        "layouts",
        "layout",
        "install",
        "discover",
        "workspace",
      ],
      shortcut: { prefix: "MARKET", aliases: ["MARKETPLACE"] },
      singleton: true,
      createInstance: (_context, options) => {
        const tab = options?.values?.tab === "layouts" ? "layouts" : "plugins";
        return {
          placement: "floating",
          title: "Marketplace",
          settings: { defaultTabId: tab },
        };
      },
    },
  ],
  setup() {
    disposeRegistryConnection = registerConnectionSource({
      id: PLUGIN_REGISTRY_CONNECTION_ID,
      name: "Plugin Registry",
      kind: "api",
      pluginId: MARKETPLACE_PANE_ID,
      authRequired: false,
    });
  },
  dispose() {
    disposeRegistryConnection?.();
    disposeRegistryConnection = null;
  },
};
