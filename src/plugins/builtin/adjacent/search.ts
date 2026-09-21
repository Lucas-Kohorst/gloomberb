export function normalizeAdjacentSearchQuery(query: string): string {
  return query.trim().replace(/^[/?]+\s*/, "").trim();
}

export function adjacentSearchTokens(query: string): string[] {
  return normalizeAdjacentSearchQuery(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function compactAdjacentText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function matchesAdjacentSearchHaystack(haystack: string, query: string): boolean {
  const tokens = adjacentSearchTokens(query);
  if (tokens.length === 0) return true;
  const text = haystack.toLowerCase();
  const compactHay = compactAdjacentText(haystack);
  return tokens.every((token) => text.includes(token) || compactHay.includes(compactAdjacentText(token)));
}

export function scoreAdjacentAndMatch(query: string, haystack: string): number {
  if (!matchesAdjacentSearchHaystack(haystack, query)) return -1;
  const tokens = adjacentSearchTokens(query);
  return tokens.reduce((score, token) => score + 20 + token.length, 0);
}

export function filterAdjacentRows<T>(
  rows: readonly T[],
  query: string,
  haystack: (row: T) => string,
): T[] {
  if (!normalizeAdjacentSearchQuery(query)) return [...rows];
  return rows.filter((row) => matchesAdjacentSearchHaystack(haystack(row), query));
}
