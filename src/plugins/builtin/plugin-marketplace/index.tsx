import type { PluginModule } from "../plugin-module";
import { PluginMarketplacePane, PLUGIN_MARKETPLACE_PANE_ID } from "./pane";

export { PLUGIN_MARKETPLACE_PANE_ID } from "./pane";
export { setMarketplaceHost } from "./store";

export const PLUGIN_MARKETPLACE_TEMPLATE_ID = "plugin-marketplace-pane";

const MARKETPLACE_DESCRIPTION =
  "Search installed and GitHub plugins, then install, toggle, update, or remove them.";

export const pluginMarketplaceModule: PluginModule = {
  panes: [
    {
      id: PLUGIN_MARKETPLACE_PANE_ID,
      name: "Plugin Marketplace",
      icon: "P",
      component: PluginMarketplacePane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 118, height: 34 },
    },
  ],

  paneTemplates: [
    {
      id: PLUGIN_MARKETPLACE_TEMPLATE_ID,
      paneId: PLUGIN_MARKETPLACE_PANE_ID,
      label: "Plugin Marketplace",
      description: MARKETPLACE_DESCRIPTION,
      keywords: [
        "plugin",
        "plugins",
        "marketplace",
        "market",
        "discover",
        "github",
        "install",
        "manage",
        "toggle",
        "plug",
        "extend",
        "addon",
        "extension",
      ],
      shortcut: { prefix: "PLUGINS", aliases: ["PLUG", "PL"] },
      singleton: true,
      createInstance: () => ({
        placement: "floating",
        title: "Plugin Marketplace",
      }),
    },
  ],
};
