import type { GloomPlugin } from "../types/plugin";
import { tickerResearchBackendPlugin } from "./builtin/ticker-research-backend-plugin";
import { getLoadablePlugins } from "./catalog";

export function getDesktopBackendPlugins(): GloomPlugin[] {
  return getLoadablePlugins().map((plugin) => {
    if (plugin.id === "ticker-research") return tickerResearchBackendPlugin;
    return plugin;
  });
}
