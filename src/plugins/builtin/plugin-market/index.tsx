import type { GloomPlugin } from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { PluginMarketPane } from "./pane";
import {
  GITHUB_PLUGIN_SEARCH_CONNECTION_ID,
  PLUGIN_MARKET_PANE_ID,
  PLUGIN_MARKET_PLUGIN_ID,
  PLUGIN_MARKET_PLUG_TEMPLATE_ID,
  PLUGIN_MARKET_TEMPLATE_ID,
} from "./types";

let disposeGithubConnection: (() => void) | null = null;

const MARKETPLACE_DESCRIPTION =
  "Search installed and GitHub plugins, then install, toggle, update, or remove them.";

/**
 * Plugin Marketplace is the one in-app plugin surface: discovery (local + GitHub)
 * plus install/toggle/update/remove. `PLUGINS` / `PLUG` open this pane. `PL` stays
 * a command-bar toggle of the same installed plugins and can jump here.
 */
export const pluginMarketPlugin: GloomPlugin = {
  id: PLUGIN_MARKET_PLUGIN_ID,
  name: "Plugin Marketplace",
  version: "1.0.0",
  description: MARKETPLACE_DESCRIPTION,
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
      description: MARKETPLACE_DESCRIPTION,
      keywords: [
        "plugin",
        "plugins",
        "marketplace",
        "market",
        "discovery",
        "discover",
        "github",
        "community",
        "search",
        "install",
        "manage",
        "toggle",
        "enable",
        "disable",
        "extensions",
      ],
      shortcut: { prefix: "PLUGINS" },
      singleton: true,
      createInstance: () => ({
        placement: "floating",
        title: "Plugin Marketplace",
      }),
    },
    {
      id: PLUGIN_MARKET_PLUG_TEMPLATE_ID,
      paneId: PLUGIN_MARKET_PANE_ID,
      label: "Plugin Marketplace",
      description: MARKETPLACE_DESCRIPTION,
      keywords: ["plugin", "plugins", "discover", "github", "install"],
      shortcut: { prefix: "PLUG" },
      singleton: true,
      createInstance: () => ({
        placement: "floating",
        title: "Plugin Marketplace",
      }),
    },
  ],

  setup() {
    disposeGithubConnection = registerConnectionSource({
      id: GITHUB_PLUGIN_SEARCH_CONNECTION_ID,
      name: "GitHub Plugins",
      kind: "api",
      pluginId: PLUGIN_MARKET_PLUGIN_ID,
      authRequired: false,
      priority: 360,
    });
  },

  dispose() {
    disposeGithubConnection?.();
    disposeGithubConnection = null;
  },
};
