import { fuzzyFilter } from "../../utils/fuzzy-search";

export function predictionSearchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index]!;
  }
  return previous[right.length]!;
}

function matchesTypo(word: string, token: string): boolean {
  if (token.length < 5 || Math.abs(word.length - token.length) > 1) return false;
  return editDistance(word, token) <= 1;
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
    return fuzzyFilter(words, token, (word) => word).length > 0
      || words.some((word) => matchesTypo(word, token));
  });
}
