import type { GloomPlugin } from "../types/plugin";
import { getLoadablePlugins } from "./catalog";
import { tickerResearchBackendPlugin } from "./builtin/ticker-research-backend-plugin";
import { predictionMarketsBackendPlugin } from "./prediction-markets/backend-plugin";

/**
 * The desktop backend runs the same builtin plugin set as the renderer, only
 * swapping the two plugins that ship a headless-only backend variant. Deriving
 * from the shared catalog keeps one source of truth for plugin order and makes
 * sure fork-only plugins are never dropped when the catalog grows.
 */
export function getDesktopBackendPlugins(): GloomPlugin[] {
  return getLoadablePlugins().map((plugin) => {
    if (plugin.id === "ticker-research") return tickerResearchBackendPlugin;
    if (plugin.id === "prediction-markets") return predictionMarketsBackendPlugin;
    return plugin;
  });
}
