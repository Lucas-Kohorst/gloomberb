import type { GloomPlugin } from "../../../types/plugin";
import { PluginMarketPane } from "./pane";
import { PLUGIN_MARKET_PANE_ID, PLUGIN_MARKET_PLUGIN_ID, PLUGIN_MARKET_TEMPLATE_ID } from "./types";

/**
 * Plugin Marketplace — the full plugin management pane (`PLUGINS` prefix).
 *
 * This is distinct from the `PL` command-bar screen ("Manage Plugins"), which is a
 * lightweight inline toggle that only flips plugins on/off without opening a pane.
 * This pane adds browse, search, install, update, and remove for external plugins,
 * plus version/source/status columns and error reporting. Keep both: the inline `PL`
 * toggle is the fast keyboard workflow; this pane is the complete management surface.
 */
export const pluginMarketPlugin: GloomPlugin = {
  id: PLUGIN_MARKET_PLUGIN_ID,
  name: "Plugin Marketplace",
  version: "1.0.0",
  description: "Browse, enable, disable, install, update, and remove plugins",
  toggleable: false,

  panes: [
    {
      id: PLUGIN_MARKET_PANE_ID,
      name: "Plugin Marketplace",
      icon: "M",
      component: PluginMarketPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: PLUGIN_MARKET_TEMPLATE_ID,
      paneId: PLUGIN_MARKET_PANE_ID,
      label: "Plugin Marketplace",
      description: "Browse, search, enable, disable, install, update, and remove plugins from within the app.",
      keywords: ["plugin", "plugins", "marketplace", "market", "install", "manage", "toggle", "enable", "disable", "extensions"],
      shortcut: { prefix: "PLUGINS" },
      createInstance: () => ({
        placement: "floating",
        title: "Plugin Marketplace",
      }),
    },
  ],

  setup() {
    // No connection sources or capabilities — this is a management pane.
  },
};


