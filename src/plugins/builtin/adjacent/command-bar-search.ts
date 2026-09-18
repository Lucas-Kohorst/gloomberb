import type {
  CommandBarResultDef,
  CommandBarSearchProvider,
  GloomPluginContext,
} from "../../../types/plugin";
import { getSharedAdjacentClient } from "./client";
import { normalizeAdjacentIndex, normalizeAdjacentMarket, normalizeAdjacentRate } from "./normalize";
import type { AdjacentIndex, AdjacentMarket, AdjacentRate } from "./types";

const RESULT_LIMIT = 6;

/** City/region in Adjacent NTI names → team nicknames the command bar should match. */
const INDEX_NICKNAMES: Record<string, readonly string[]> = {
  arizona: ["cardinals"],
  atlanta: ["falcons"],
  baltimore: ["ravens"],
  buffalo: ["bills"],
  carolina: ["panthers"],
  chicago: ["bears"],
  cincinnati: ["bengals"],
  cleveland: ["browns"],
  dallas: ["cowboys"],
  denver: ["broncos"],
  detroit: ["lions"],
  "green bay": ["packers"],
  houston: ["texans"],
  indianapolis: ["colts"],
  jacksonville: ["jaguars"],
  "kansas city": ["chiefs"],
  "las vegas": ["raiders"],
  "los angeles": ["chargers", "rams"],
  miami: ["dolphins"],
  minnesota: ["vikings"],
  "new england": ["patriots"],
  "new orleans": ["saints"],
  "new york": ["giants", "jets"],
  philadelphia: ["eagles"],
  pittsburgh: ["steelers"],
  "san francisco": ["49ers", "niners"],
  seattle: ["seahawks"],
  "tampa bay": ["buccaneers", "bucs"],
  tennessee: ["titans"],
  washington: ["commanders"],
};

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function tokensOf(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
}

function nicknameHaystack(name: string): string {
  const lower = name.toLowerCase();
  const extra: string[] = [];
  for (const [place, nicks] of Object.entries(INDEX_NICKNAMES)) {
    if (lower.includes(place)) extra.push(...nicks);
  }
  return extra.join(" ");
}

export function adjacentCatalogHaystack(row: {
  ticker?: string;
  name: string;
  id: string;
}): string {
  return [row.ticker, row.name, row.id, nicknameHaystack(row.name)].filter(Boolean).join(" ");
}

/** Any distinctive token can hit; matching every token ranks higher. */
export function scoreAdjacentCatalogMatch(query: string, haystack: string): number {
  const tokens = tokensOf(query);
  if (tokens.length === 0) return -1;
  const hay = haystack.toLowerCase();
  const hayCompact = compact(haystack);
  let matched = 0;
  let score = 0;
  for (const token of tokens) {
    if (hay.includes(token) || hayCompact.includes(compact(token))) {
      matched += 1;
      score += 20 + token.length;
    }
  }
  if (matched === 0) return -1;
  if (matched === tokens.length) score += 250;
  return score;
}

function rankRows<T>(
  query: string,
  rows: readonly T[],
  haystack: (row: T) => string,
): T[] {
  return rows
    .map((row) => ({ row, score: scoreAdjacentCatalogMatch(query, haystack(row)) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || haystack(left.row).localeCompare(haystack(right.row)))
    .slice(0, RESULT_LIMIT)
    .map((entry) => entry.row);
}

export function matchAdjacentIndices(
  query: string,
  indices: readonly AdjacentIndex[],
): AdjacentIndex[] {
  const rows = indices.map(normalizeAdjacentIndex);
  const ranked = rankRows(query, rows, adjacentCatalogHaystack);
  const byId = new Map(indices.map((index) => [index.index_id, index]));
  return ranked.flatMap((row) => {
    const index = byId.get(row.id);
    return index ? [index] : [];
  });
}

export function matchAdjacentRates(
  query: string,
  rates: readonly AdjacentRate[],
): AdjacentRate[] {
  const rows = rates.map(normalizeAdjacentRate);
  const ranked = rankRows(query, rows, (row) => adjacentCatalogHaystack({
    ticker: row.id,
    name: row.name,
    id: row.id,
  }));
  const byId = new Map(rates.map((rate) => [rate.rate_id, rate]));
  return ranked.flatMap((row) => {
    const rate = byId.get(row.id);
    return rate ? [rate] : [];
  });
}

export type AdjacentCatalogTemplateId =
  | "adjacent-markets-pane"
  | "adjacent-indices-pane"
  | "adjacent-rates-pane";

export interface AdjacentCatalogOpen {
  templateId: AdjacentCatalogTemplateId;
  arg?: string;
}

function sameToken(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function marketsFromSearch(response: {
  markets?: readonly AdjacentMarket[] | null;
  data?: readonly AdjacentMarket[] | null;
}): AdjacentMarket[] {
  return [...(response.markets ?? response.data ?? [])];
}

export function pickAdjacentCatalogOpen(
  query: string,
  catalogs: {
    indices: readonly AdjacentIndex[];
    rates: readonly AdjacentRate[];
    markets: readonly AdjacentMarket[];
  },
): AdjacentCatalogOpen {
  const trimmed = query.trim();
  if (!trimmed) return { templateId: "adjacent-markets-pane" };

  const indexRows = catalogs.indices.map(normalizeAdjacentIndex);
  const exactIndex = indexRows.find((row) => sameToken(row.ticker, trimmed) || sameToken(row.id, trimmed));
  if (exactIndex) return { templateId: "adjacent-indices-pane", arg: exactIndex.ticker };

  const rateRows = catalogs.rates.map(normalizeAdjacentRate);
  const exactRate = rateRows.find((row) => sameToken(row.id, trimmed) || sameToken(row.name, trimmed));
  if (exactRate) return { templateId: "adjacent-rates-pane", arg: exactRate.id };

  const indexHits = matchAdjacentIndices(trimmed, catalogs.indices);
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2 && indexHits[0]) {
    const haystack = adjacentCatalogHaystack(normalizeAdjacentIndex(indexHits[0]));
    if (scoreAdjacentCatalogMatch(trimmed, haystack) >= 250) {
      const ticker = indexHits[0].ticker?.trim() || indexHits[0].index_id.toUpperCase();
      return { templateId: "adjacent-indices-pane", arg: ticker };
    }
  }

  if (catalogs.markets.length > 0) {
    return { templateId: "adjacent-markets-pane", arg: trimmed };
  }
  if (indexHits[0]) {
    const ticker = indexHits[0].ticker?.trim() || indexHits[0].index_id.toUpperCase();
    return { templateId: "adjacent-indices-pane", arg: ticker };
  }
  const rateHits = matchAdjacentRates(trimmed, catalogs.rates);
  if (rateHits[0]) return { templateId: "adjacent-rates-pane", arg: rateHits[0].rate_id };
  return { templateId: "adjacent-markets-pane", arg: trimmed };
}

export async function openAdjacentCatalogSearch(
  ctx: Pick<GloomPluginContext, "createPaneFromTemplate">,
  query: string,
): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) {
    ctx.createPaneFromTemplate("adjacent-markets-pane");
    return;
  }
  const client = getSharedAdjacentClient();
  const [indices, rates, marketResponse] = await Promise.all([
    client.getIndices().catch(() => ({ data: [] as AdjacentIndex[] })),
    client.getRates().catch(() => ({ data: [] as AdjacentRate[] })),
    client.searchMarkets(trimmed, 12).catch(() => ({ markets: [] as AdjacentMarket[] })),
  ]);
  const target = pickAdjacentCatalogOpen(trimmed, {
    indices: indices.data ?? [],
    rates: rates.data ?? [],
    markets: marketsFromSearch(marketResponse),
  });
  ctx.createPaneFromTemplate(target.templateId, target.arg ? { arg: target.arg } : undefined);
}

export function createAdjacentCatalogSearchProvider(
  ctx: GloomPluginContext,
): CommandBarSearchProvider {
  return {
    id: "adjacent-catalog",
    category: "Data",
    priority: 110,
    minQueryLength: 3,
    debounceMs: 200,
    async provide(query, _context, signal) {
      const client = getSharedAdjacentClient();
      const [indices, rates, marketResponse] = await Promise.all([
        client.getIndices().catch(() => ({ data: [] as AdjacentIndex[] })),
        client.getRates().catch(() => ({ data: [] as AdjacentRate[] })),
        client.searchMarkets(query, RESULT_LIMIT).catch(() => ({ markets: [] as AdjacentMarket[] })),
      ]);
      if (signal.aborted) return [];

      const indexHits = matchAdjacentIndices(query, indices.data ?? []);
      const rateHits = matchAdjacentRates(query, rates.data ?? []);
      const markets = marketsFromSearch(marketResponse).slice(0, RESULT_LIMIT);
      const results: CommandBarResultDef[] = [];

      for (const market of markets) {
        const row = normalizeAdjacentMarket(market);
        results.push({
          id: `market:${market.id}`,
          label: row.ticker,
          detail: row.title,
          right: "ADJ",
          category: "Adjacent",
          keywords: [row.ticker, row.title, row.platform, market.id, "adjacent", "market"],
          execute: () => {
            ctx.createPaneFromTemplate("adjacent-markets-pane", { arg: row.title });
          },
        });
      }
      for (const index of indexHits) {
        const ticker = index.ticker?.trim() || index.index_id.toUpperCase();
        results.push({
          id: `index:${index.index_id}`,
          label: ticker,
          detail: index.name,
          right: "ADI",
          keywords: [ticker, index.name, index.index_id, "adjacent", "index", "nti"],
          execute: () => {
            ctx.createPaneFromTemplate("adjacent-indices-pane", { arg: ticker });
          },
        });
      }
      for (const rate of rateHits) {
        results.push({
          id: `rate:${rate.rate_id}`,
          label: rate.name,
          detail: rate.rate_id,
          right: "ADR",
          keywords: [rate.name, rate.rate_id, "adjacent", "rate"],
          execute: () => {
            ctx.createPaneFromTemplate("adjacent-rates-pane", { arg: rate.rate_id });
          },
        });
      }
      return results;
    },
  };
}
