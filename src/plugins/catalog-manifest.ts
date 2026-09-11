import { getPluginCatalog } from "./catalog";

/**
 * The public description of the plugins that ship inside Gloomberb.
 *
 * The plugin directory has to list built-ins alongside installable ones, but a
 * built-in has no repository to read metadata from. Hand-maintaining that half
 * elsewhere meant it silently drifted every time a built-in changed its panes
 * or description, so it is derived from the live catalog here instead and
 * checked against a committed snapshot in CI.
 */

export interface BuiltinPluginManifestEntry {
  id: string;
  name: string;
  description: string;
  /** Curated, since the catalog has no notion of categories. */
  categories: string[];
  toggleable: boolean;
  featured?: true;
  contributes: {
    panes: string[];
    capabilities: string[];
    broker: boolean;
  };
}

/**
 * Editorial metadata the runtime catalog does not carry. Anything missing here
 * is reported by `generate-plugin-manifest.ts` rather than silently defaulted,
 * so a new built-in cannot slip into the directory uncategorised.
 */
const EDITORIAL: Record<string, { categories: string[]; featured?: true }> = {
  adjacent: { categories: ["data"] },
  "cboe-book": { categories: ["research", "data"] },
  "cfpb-complaints": { categories: ["research", "data"] },
  "clinical-trials": { categories: ["research", "data"] },
  "comment-letters": { categories: ["research", "data"] },
  "courtlistener": { categories: ["research", "data"] },
  "eia-energy": { categories: ["research", "data"] },
  "fdic-bank": { categories: ["research", "data"] },
  "filing-diff": { categories: ["research", "data"] },
  "foia-logs": { categories: ["research", "data"] },
  "google-books": { categories: ["research", "data"] },
  "iborrowdesk": { categories: ["research", "data"] },
  "levels-fyi": { categories: ["research", "data"] },
  "open-corporates": { categories: ["research", "data"] },
  "open-payments": { categories: ["research", "data"] },
  "openfda": { categories: ["research", "data"] },
  "sec-8k-alerts": { categories: ["research", "data"] },
  "sec-fts": { categories: ["research", "data"] },
  "short-campaigns": { categories: ["research", "data"] },
  "workplace-signals": { categories: ["research", "data"] },

  ai: { categories: ["ai"] },
  alerts: { categories: ["alerts"] },
  application: { categories: ["core"] },
  broker: { categories: ["broker"] },
  coingecko: { categories: ["data"] },
  debug: { categories: ["developer"] },
  "gloomberb-cloud": { categories: ["data", "cloud"], featured: true },
  macro: { categories: ["macro"] },
  "market-overview": { categories: ["markets"] },
  news: { categories: ["news"] },
  notes: { categories: ["productivity"] },
  "plugin-inspector": { categories: ["developer"] },
  portfolio: { categories: ["portfolio"] },
  "research-search": { categories: ["research", "news"] },
  "ticker-research": { categories: ["research"] },
  yahoo: { categories: ["data"] },
};

export interface BuiltinManifest {
  version: 1;
  plugins: BuiltinPluginManifestEntry[];
  /** Built-in ids with no editorial entry; a non-empty list fails generation. */
  uncategorised: string[];
}

export function buildBuiltinManifest(): BuiltinManifest {
  const uncategorised: string[] = [];

  const plugins = getPluginCatalog()
    .map(({ plugin }) => {
      const editorial = EDITORIAL[plugin.id];
      if (!editorial) uncategorised.push(plugin.id);

      return {
        id: plugin.id,
        name: plugin.name,
        description: plugin.description ?? "",
        categories: editorial?.categories ?? [],
        toggleable: plugin.toggleable === true,
        ...(editorial?.featured ? { featured: true as const } : {}),
        contributes: {
          panes: (plugin.panes ?? []).map((pane) => pane.id).sort(),
          capabilities: (plugin.capabilities ?? [])
            .map((capability) => {
              const value = capability as { id?: string; kind?: string };
              return value.id ?? value.kind ?? "capability";
            })
            .sort(),
          broker: !!plugin.broker,
        },
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  return { version: 1, plugins, uncategorised: uncategorised.sort() };
}
