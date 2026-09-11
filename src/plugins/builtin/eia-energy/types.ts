import type { ChartSeriesCatalogProvider } from "../../../types/plugin";

export const EIA_ENERGY_PLUGIN_ID = "eia-energy";
export const EIA_ENERGY_CONNECTION_ID = "eia-energy";
export const EIA_CHART_CAPABILITY_ID = "eia-energy";
export const EIA_API_BASE_URL = "https://api.eia.gov/v2";
/** Public demo key with strict rate limits. Works out of the box; users can drop in a free key. */
export const EIA_DEMO_KEY = "DEMO_KEY";
export const EIA_PANE_ID = "energy";

export type EiaSeriesKind = "inventory" | "price";

/**
 * One chartable EIA v2 series. `route` is the path under /v2 (without /data),
 * `facetSeries` is the EIA series facet code, verified against the live
 * facet endpoints except where noted.
 */
export interface EiaSeriesDef {
  id: string;
  label: string;
  /** Short tag shown in the Source column. */
  short: string;
  group: "Inventories" | "Production" | "Prices";
  route: string;
  frequency: "weekly";
  facetSeries: string;
  kind: EiaSeriesKind;
  /** Display unit, e.g. MBBL (thousand barrels) or $/gal. */
  unit: string;
  decimals: number;
  description: string;
  browserUrl: string;
}

export const EIA_SERIES: readonly EiaSeriesDef[] = [
  {
    id: "crude-stocks",
    label: "U.S. crude oil stocks",
    short: "CRUDE",
    group: "Inventories",
    route: "petroleum/stoc/wstk",
    frequency: "weekly",
    facetSeries: "WCESTUS1",
    kind: "inventory",
    unit: "MBBL",
    decimals: 0,
    description: "U.S. ending stocks of crude oil excluding SPR, thousand barrels, weekly.",
    browserUrl: "https://www.eia.gov/opendata/browser/petroleum/stoc/wstk",
  },
  {
    id: "gasoline-stocks",
    label: "U.S. gasoline stocks",
    short: "GASOLINE",
    group: "Inventories",
    route: "petroleum/stoc/wstk",
    frequency: "weekly",
    facetSeries: "WGTSTUS1",
    kind: "inventory",
    unit: "MBBL",
    decimals: 0,
    description: "U.S. ending stocks of total motor gasoline, thousand barrels, weekly.",
    browserUrl: "https://www.eia.gov/opendata/browser/petroleum/stoc/wstk",
  },
  {
    id: "distillate-stocks",
    label: "U.S. distillate stocks",
    short: "DISTILLATE",
    group: "Inventories",
    route: "petroleum/stoc/wstk",
    frequency: "weekly",
    facetSeries: "WDISTUS1",
    kind: "inventory",
    unit: "MBBL",
    decimals: 0,
    description: "U.S. ending stocks of distillate fuel oil, thousand barrels, weekly.",
    browserUrl: "https://www.eia.gov/opendata/browser/petroleum/stoc/wstk",
  },
  {
    id: "gas-storage",
    label: "U.S. natural gas storage",
    short: "GAS STORAGE",
    group: "Inventories",
    route: "natural-gas/stor/wkly",
    frequency: "weekly",
    facetSeries: "NW2_EPG0_SWO_R48_BCF",
    kind: "inventory",
    unit: "BCF",
    decimals: 0,
    description: "Weekly Lower 48 working natural gas in underground storage, billion cubic feet.",
    browserUrl: "https://www.eia.gov/opendata/browser/natural-gas/stor/wkly",
  },
  {
    id: "gasoline-price",
    label: "U.S. retail gasoline price",
    short: "GAS $",
    group: "Prices",
    route: "petroleum/pri/gnd",
    frequency: "weekly",
    facetSeries: "EMM_EPMR_PTE_NUS_DPG",
    kind: "price",
    unit: "$/gal",
    decimals: 3,
    description: "U.S. regular all-formulations retail gasoline price, dollars per gallon, weekly.",
    browserUrl: "https://www.eia.gov/opendata/browser/petroleum/pri/gnd",
  },
  {
    id: "diesel-price",
    label: "U.S. retail diesel price",
    short: "DIESEL $",
    group: "Prices",
    route: "petroleum/pri/gnd",
    frequency: "weekly",
    facetSeries: "EMD_EPD2D_PTE_NUS_DPG",
    kind: "price",
    unit: "$/gal",
    decimals: 3,
    description: "U.S. No 2 diesel retail price, dollars per gallon, weekly.",
    browserUrl: "https://www.eia.gov/opendata/browser/petroleum/pri/gnd",
  },
  {
    // Facet code follows the EIA v2 docs for weekly supply estimates; it was
    // not live-verified (DEMO_KEY was rate-limited). The pane surfaces fetch
    // errors per series, so a wrong code degrades to an error state, not a crash.
    id: "crude-production",
    label: "U.S. crude oil production",
    short: "OUTPUT",
    group: "Production",
    route: "petroleum/sum/sndw",
    frequency: "weekly",
    facetSeries: "WCRFPUS2",
    kind: "inventory",
    unit: "MBBL/D",
    decimals: 0,
    description: "U.S. field production of crude oil, thousand barrels per day, weekly.",
    browserUrl: "https://www.eia.gov/opendata/browser/petroleum/sum/sndw",
  },
];

export const DEFAULT_EIA_SERIES_ID = "crude-stocks";

export function findEiaSeries(seriesId: string): EiaSeriesDef | undefined {
  return EIA_SERIES.find((entry) => entry.id === seriesId);
}

export function resolveEiaSeriesId(seriesId: unknown): string {
  return typeof seriesId === "string" && findEiaSeries(seriesId)
    ? seriesId
    : DEFAULT_EIA_SERIES_ID;
}

/** Match a command-bar arg ("diesel", "gas storage") to a series id. */
export function matchEiaSeriesId(arg: unknown): string {
  if (typeof arg !== "string" || !arg.trim()) return DEFAULT_EIA_SERIES_ID;
  const tokens = arg.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return DEFAULT_EIA_SERIES_ID;
  let best: { id: string; score: number } | null = null;
  for (const entry of EIA_SERIES) {
    const haystack = `${entry.id} ${entry.label} ${entry.short} ${entry.group}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (entry.id === token) score += 3;
      else if (haystack.includes(token)) score += 1;
      else {
        score = -1;
        break;
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { id: entry.id, score };
  }
  return best?.id ?? DEFAULT_EIA_SERIES_ID;
}

export const eiaSeriesCatalog: ChartSeriesCatalogProvider = {
  id: "eia-energy",
  name: "EIA Energy",
  sourceId: "eia-energy",
  entries: EIA_SERIES.map((entry) => ({
    id: entry.id,
    expression: `CAP:${EIA_CHART_CAPABILITY_ID}:${entry.id}`,
    label: entry.label,
    source: "EIA",
    searchText: `${entry.label} ${entry.short} ${entry.group} eia energy oil gas weekly`.toLowerCase(),
    description: `U.S. Energy Information Administration · ${entry.description}`,
    detail: "EIA",
    unit: entry.unit,
    frequency: entry.frequency,
  })),
  assist: {
    keywords: ["eia", "energy", "oil stocks", "gas storage", "fuel prices", "crude production"],
    examples: ["crude oil stocks", "natural gas storage", "retail gasoline price"],
  },
};
