import type { Dispatch } from "react";
import {
  PLUGIN_MARKET_TEMPLATE_ID,
} from "../../../plugins/builtin/plugin-market/types";
import { nextDisabledPluginIds } from "../../../plugins/builtin/plugin-market/rows";
import type { PluginRegistry } from "../../../plugins/registry";
import type { AppAction, AppState } from "../../../state/app/context";
import type { ResultItem } from "../list/model";

const MARKETPLACE_QUERY_TERMS = ["market", "discover", "github", "install", "search", "plug"];

export function pluginToggleQuery(query: string): string {
  const normalized = query.trim().toLowerCase();
  return normalized === "plugin" || normalized === "plugins" ? "" : normalized;
}

export function marketplaceJumpMatchesQuery(query: string): boolean {
  const pluginQuery = pluginToggleQuery(query);
  return !pluginQuery || MARKETPLACE_QUERY_TERMS.some((term) => pluginQuery.includes(term));
}

export function buildMarketplaceJumpItem(pluginRegistry: PluginRegistry): ResultItem {
  return {
    id: "plugin-market-open",
    label: "Plugin Marketplace",
    detail: "Search installed and GitHub plugins, then install, toggle, update, or remove",
    category: "Plugins",
    kind: "action",
    right: "PLUGINS",
    shortcutQuery: "PLUGINS",
    defaultSelectable: false,
    action: () => {
      pluginRegistry.createPaneFromTemplate(PLUGIN_MARKET_TEMPLATE_ID);
    },
  };
}

export function pluginMatchesToggleQuery(
  plugin: { id: string; name: string; description?: string },
  pluginQuery: string,
  pluginRegistry: PluginRegistry,
): boolean {
  if (!pluginQuery) return true;
  return [
    plugin.name,
    plugin.id,
    plugin.description,
    ...pluginRegistry.getPluginPaneIds(plugin.id).flatMap((paneId) => [
      paneId,
      pluginRegistry.panes.get(paneId)?.name,
    ]),
    ...pluginRegistry.getPluginPaneTemplateIds(plugin.id).flatMap((templateId) => {
      const template = pluginRegistry.paneTemplates.get(templateId);
      return [
        templateId,
        template?.label,
        template?.description,
        ...(template?.keywords ?? []),
      ];
    }),
  ].some((term) => typeof term === "string" && term.toLowerCase().includes(pluginQuery));
}

export function buildPluginToggleItems({
  disabledPlugins,
  dispatch,
  getConfig,
  persistConfig,
  pluginRegistry,
  query,
}: {
  disabledPlugins: readonly string[];
  dispatch: Dispatch<AppAction>;
  getConfig: () => AppState["config"];
  persistConfig: (nextConfig: AppState["config"]) => void;
  pluginRegistry: PluginRegistry;
  query: string;
}): ResultItem[] {
  const pluginQuery = pluginToggleQuery(query);
  const toggleable = [...pluginRegistry.allPlugins.values()].filter((plugin) => plugin.toggleable);
  const filtered = toggleable.filter((plugin) => pluginMatchesToggleQuery(plugin, pluginQuery, pluginRegistry));
  const jump = buildMarketplaceJumpItem(pluginRegistry);
  const includeJump = marketplaceJumpMatchesQuery(query);

  const toggleItems = filtered.map((plugin): ResultItem => {
    const enabled = !disabledPlugins.includes(plugin.id);
    const toggleAction = () => {
      dispatch({ type: "TOGGLE_PLUGIN", pluginId: plugin.id });
      const currentConfig = getConfig();
      persistConfig({
        ...currentConfig,
        disabledPlugins: nextDisabledPluginIds(disabledPlugins, plugin.id, enabled),
      });
      if (enabled) {
        for (const paneId of pluginRegistry.getPluginPaneIds(plugin.id)) {
          pluginRegistry.hidePane(paneId);
        }
      }
    };
    return {
      id: `plugin:${plugin.id}`,
      label: plugin.name,
      detail: plugin.description || "",
      category: "Plugins",
      kind: "plugin",
      checked: enabled,
      pluginToggle: toggleAction,
      action: toggleAction,
    };
  });

  if (!includeJump) return toggleItems;
  if (pluginQuery) return [jump, ...toggleItems];
  return [...toggleItems, jump];
}
