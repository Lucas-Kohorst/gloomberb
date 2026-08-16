export const PLUGIN_MARKET_PLUGIN_ID = "plugin-market";
export const PLUGIN_MARKET_PANE_ID = "plugin-market";
export const PLUGIN_MARKET_TEMPLATE_ID = "plugin-market-pane";

export interface PluginRow {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  toggleable: boolean;
  source: "built-in" | "external";
  dirName?: string;
  hasError?: boolean;
  error?: string;
}

export interface ExternalPluginEntry {
  dirName: string;
  pluginId: string | null;
  version: string;
  description: string;
  hasError: boolean;
  error?: string;
}

export interface OperationResult {
  name: string;
  success: boolean;
  message: string;
}
