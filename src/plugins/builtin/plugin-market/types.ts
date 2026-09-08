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
  /** Directory to update when the plugin is part of a monorepo. */
  managementDirName?: string;
  /** Monorepo plugins are updated together and cannot be removed individually. */
  removable?: boolean;
  hasError?: boolean;
  error?: string;
  stars?: number;
  url?: string;
  fullName?: string;
}

export interface ExternalPluginEntry {
  dirName: string;
  /** Top-level install directory, when this entry is nested in a monorepo. */
  managementDirName?: string;
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
