import { fuzzyFilter } from "../../utils/fuzzy-search";

export function predictionSearchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Token-AND match against a market/event haystack.
 *
 * Substring covers spaced multi-word queries. Per-word fuzzy keeps typo
 * tolerance (BITCON → bitcoin) from matching short tokens like "ipo"
 * across a concatenated grouped-row haystack.
 */
export function matchesPredictionSearchHaystack(
  haystack: string,
  query: string,
): boolean {
  const tokens = predictionSearchTokens(query);
  if (tokens.length === 0) return true;
  const text = haystack.toLowerCase();
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.every((token) => {
    if (text.includes(token)) return true;
    return fuzzyFilter(words, token, (word) => word).length > 0;
  });
}
