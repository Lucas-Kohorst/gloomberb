import type { PluginModule } from "../plugin-module";

export { PLUGIN_MARKETPLACE_PANE_ID } from "./pane";
export { setMarketplaceHost } from "./store";

// Kept as a named export so existing command-bar integrations continue to work.
// The unified pane owns the actual template now.
export const PLUGIN_MARKETPLACE_TEMPLATE_ID = "marketplace-pane";

export const pluginMarketplaceModule: PluginModule = {};
