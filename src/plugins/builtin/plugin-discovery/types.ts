export const PLUGIN_DISCOVERY_PLUGIN_ID = "plugin-discovery";
export const PLUGIN_DISCOVERY_PANE_ID = "plugin-discovery";

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

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
