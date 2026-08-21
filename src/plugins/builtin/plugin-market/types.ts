export const PLUGIN_MARKET_PLUGIN_ID = "plugin-market";
export const PLUGIN_MARKET_PANE_ID = "plugin-market";
export const PLUGIN_MARKET_TEMPLATE_ID = "plugin-market-pane";
export const PLUGIN_MARKET_PLUG_TEMPLATE_ID = "plugin-market-plug-pane";
export const GITHUB_PLUGIN_SEARCH_CONNECTION_ID = "github-plugin-search";

export type PluginSource = "built-in" | "external" | "github";

export interface PluginRow {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  toggleable: boolean;
  source: PluginSource;
  dirName?: string;
  hasError?: boolean;
  error?: string;
  stars?: number;
  url?: string;
  fullName?: string;
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

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  html_url: string;
  owner: { login: string };
  updated_at: string;
}

export interface PluginSearchResult {
  id: number;
  fullName: string;
  description: string;
  stars: number;
  url: string;
  owner: string;
  updatedAt: string;
}
