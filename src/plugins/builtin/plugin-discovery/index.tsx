import type { GloomPlugin } from "../../../types/plugin";
import { PluginDiscoveryPane } from "./pane";
import { PLUGIN_DISCOVERY_PANE_ID, PLUGIN_DISCOVERY_PLUGIN_ID } from "./types";

export const pluginDiscoveryPlugin: GloomPlugin = {
  id: PLUGIN_DISCOVERY_PLUGIN_ID,
  name: "Plugin Discovery",
  version: "1.0.0",
  description: "Search and install Gloomberb plugins from GitHub",
  toggleable: true,

  panes: [
    {
      id: PLUGIN_DISCOVERY_PANE_ID,
      name: "Plugin Discovery",
      icon: "P",
      component: PluginDiscoveryPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "plugin-discovery-pane",
      paneId: PLUGIN_DISCOVERY_PANE_ID,
      label: "Plugin Discovery",
      description: "Search GitHub for installable Gloomberb plugins by keyword. Browse stars and descriptions, open repos, and install with one key.",
      keywords: ["plugins", "search", "discover", "install", "github", "registry"],
      shortcut: { prefix: "PLUG" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
