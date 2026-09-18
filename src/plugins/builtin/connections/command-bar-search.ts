import type { CommandBarResultDef, CommandBarSearchProvider, GloomPluginContext } from "../../../types/plugin";
import { listConnectionSources, type ConnectionSourceDef } from "./register";

const RESULT_LIMIT = 6;

export function matchConnectionSources(
  query: string,
  sources: readonly ConnectionSourceDef[] = listConnectionSources(),
): ConnectionSourceDef[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
  if (tokens.length === 0) return [];
  return sources
    .filter((source) => {
      const haystack = `${source.id} ${source.name} ${source.kind}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .slice(0, RESULT_LIMIT);
}

export function connectionSourceSearchResults(
  query: string,
  openConnections: () => void,
  sources?: readonly ConnectionSourceDef[],
): CommandBarResultDef[] {
  return matchConnectionSources(query, sources).map((source) => ({
    id: source.id,
    label: source.name,
    detail: source.kind,
    right: "CONN",
    keywords: [source.id, source.name, source.kind, "connection"],
    execute: () => openConnections(),
  }));
}

export function createConnectionSourceSearchProvider(ctx: GloomPluginContext): CommandBarSearchProvider {
  return {
    id: "connections-sources",
    category: "Connections",
    priority: 160,
    minQueryLength: 3,
    debounceMs: 150,
    async provide(query) {
      return connectionSourceSearchResults(query, () => {
        ctx.createPaneFromTemplate("connections-pane");
      });
    },
  };
}
