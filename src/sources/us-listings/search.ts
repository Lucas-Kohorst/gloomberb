import type { InstrumentSearchResult } from "../../types/instrument";
import { compactSearchText, normalizeSearchText, rankTickerSearchItems } from "../../tickers/search/ranking";
import { US_LISTINGS_PROVIDER_ID, type UsListedSecurity, type UsListingsUniverse } from "./types";

const SEARCH_POOL = 250;
const SEARCH_LIMIT = 24;

export function searchUsListingsUniverse(
  universe: UsListingsUniverse,
  query: string,
  limit = SEARCH_LIMIT,
): InstrumentSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = compactSearchText(query);
  if (!normalizedQuery) return [];

  const exact: UsListedSecurity[] = [];
  const prefix: UsListedSecurity[] = [];
  const named: UsListedSecurity[] = [];

  for (const security of universe.securities) {
    const compactSymbol = compactSearchText(security.symbol);
    if (compactQuery && compactSymbol === compactQuery) {
      exact.push(security);
      continue;
    }
    if (compactQuery && compactSymbol.startsWith(compactQuery)) {
      if (prefix.length < SEARCH_POOL) prefix.push(security);
      continue;
    }
    const name = normalizeSearchText(security.name);
    if (named.length < SEARCH_POOL && (name.startsWith(normalizedQuery) || name.includes(normalizedQuery))) {
      named.push(security);
    }
  }

  const pool = [...exact, ...prefix, ...named].slice(0, SEARCH_POOL);

  const ranked = rankTickerSearchItems(
    pool.map((security) => ({
      id: `${security.symbol}:${security.exchange}`,
      label: security.symbol,
      detail: security.name,
      kind: "search" as const,
      category: "Primary Listing",
      right: security.exchange,
      symbol: security.symbol,
      searchAliases: [security.symbol, compactSearchText(security.symbol)],
    })),
    query,
  ).slice(0, limit);

  const byId = new Map(pool.map((security) => [`${security.symbol}:${security.exchange}`, security]));
  return ranked.flatMap((item) => {
    const security = byId.get(item.id);
    if (!security) return [];
    return [{
      providerId: US_LISTINGS_PROVIDER_ID,
      symbol: security.symbol,
      name: security.name,
      exchange: security.exchange,
      type: security.type,
      currency: "USD",
      primaryExchange: security.exchange,
    }];
  });
}
