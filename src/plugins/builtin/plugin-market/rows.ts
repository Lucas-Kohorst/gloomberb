import type { PluginColumnId } from "./columns";
import type { PluginRow, PluginSearchResult } from "./types";

export function pluginRowMatchesQuery(row: PluginRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.id, row.description, row.fullName, row.dirName]
    .some((value) => typeof value === "string" && value.toLowerCase().includes(q));
}

export function communityRepoName(fullName: string): string {
  return fullName.split("/")[1] ?? fullName;
}

export function isCommunityResultInstalled(
  result: PluginSearchResult,
  local: readonly PluginRow[],
): boolean {
  const repo = communityRepoName(result.fullName).toLowerCase();
  const full = result.fullName.toLowerCase();
  return local.some((row) => {
    const id = row.id.toLowerCase();
    const dir = row.dirName?.toLowerCase();
    const name = row.name.toLowerCase();
    return id === repo || id === full || dir === repo || dir === full || name === full;
  });
}

export function communityResultToRow(result: PluginSearchResult): PluginRow {
  return {
    id: `github:${result.fullName}`,
    name: result.fullName,
    description: result.description,
    version: `★ ${result.stars}`,
    enabled: false,
    toggleable: false,
    source: "github",
    stars: result.stars,
    url: result.url,
    fullName: result.fullName,
    dirName: communityRepoName(result.fullName),
  };
}

export function mergeMarketplaceRows(
  local: readonly PluginRow[],
  community: readonly PluginSearchResult[],
  query: string,
): PluginRow[] {
  const filteredLocal = local.filter((row) => pluginRowMatchesQuery(row, query));
  if (!query.trim()) return filteredLocal;
  const extra = community
    .filter((item) => !isCommunityResultInstalled(item, local))
    .map(communityResultToRow);
  return [...filteredLocal, ...extra];
}

export function nextDisabledPluginIds(
  disabled: readonly string[],
  pluginId: string,
  currentlyEnabled: boolean,
): string[] {
  return currentlyEnabled
    ? [...disabled, pluginId]
    : disabled.filter((id) => id !== pluginId);
}

export function applyPluginToggle(
  row: PluginRow,
  disabled: readonly string[],
): string[] | null {
  if (!row.toggleable) return null;
  return nextDisabledPluginIds(disabled, row.id, row.enabled);
}

export function comparePluginRows(a: PluginRow, b: PluginRow, columnId: PluginColumnId): number {
  switch (columnId) {
    case "name":
      return a.name.localeCompare(b.name);
    case "description":
      return a.description.localeCompare(b.description);
    case "version":
      return a.version.localeCompare(b.version);
    case "source":
      return a.source.localeCompare(b.source);
    case "status": {
      const rank = (row: PluginRow) => {
        if (row.hasError) return 2;
        if (row.source === "github") return 3;
        return row.enabled ? 0 : 1;
      };
      return rank(a) - rank(b);
    }
  }
}
