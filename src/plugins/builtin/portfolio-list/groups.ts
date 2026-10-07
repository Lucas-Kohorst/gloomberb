import type { Watchlist, WatchlistGroup } from "../../../types/ticker";

export type WatchlistLayoutRow =
  | { kind: "header"; id: string; name?: string }
  | { kind: "symbol"; symbol: string };

export type WatchlistLayout =
  | { kind: "flat"; symbols: readonly string[] }
  | { kind: "grouped"; symbols: string[]; rows: WatchlistLayoutRow[] };

const UNGROUPED_HEADER_ID = "ungrouped";

function createGroupId(): string {
  return crypto.randomUUID();
}

function groupSymbols(group: WatchlistGroup, members: ReadonlySet<string>, seen: Set<string>): string[] {
  if (!Array.isArray(group.symbols)) return [];
  const symbols: string[] = [];
  for (const symbol of group.symbols) {
    if (typeof symbol !== "string" || !members.has(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
  }
  return symbols;
}

/** Members only, each symbol in the earliest group, empty groups dropped. */
export function normalizeWatchlistGroups(
  groups: readonly WatchlistGroup[] | undefined,
  members: ReadonlySet<string>,
): WatchlistGroup[] | undefined {
  if (!groups || groups.length === 0) return undefined;
  const seen = new Set<string>();
  const next: WatchlistGroup[] = [];
  for (const group of groups) {
    if (!group || typeof group.id !== "string" || !group.id || typeof group.name !== "string" || !group.name.trim()) continue;
    const symbols = groupSymbols(group, members, seen);
    if (symbols.length === 0) continue;
    const unchanged = symbols.length === group.symbols.length
      && symbols.every((symbol, index) => symbol === group.symbols[index]);
    next.push(unchanged ? group : { id: group.id, name: group.name, symbols });
  }
  if (next.length === 0) return undefined;
  if (next.length === groups.length && next.every((group, index) => group === groups[index])) return groups as WatchlistGroup[];
  return next;
}

function withoutGroups(watchlist: Watchlist): Watchlist {
  if (!watchlist.groups) return watchlist;
  const { groups: _groups, ...rest } = watchlist;
  return rest;
}

function replaceGroups(watchlist: Watchlist, groups: WatchlistGroup[] | undefined): Watchlist {
  if (!groups || groups.length === 0) return withoutGroups(watchlist);
  if (groups === watchlist.groups) return watchlist;
  return { ...watchlist, groups };
}

/**
 * Symbol order for the open list. Column sort and a team list leave the
 * input order untouched, and so does a list with no groups. Otherwise
 * ungrouped symbols lead, in input order, and each group follows in array
 * order with its own symbol order. The leading header is not a stored group.
 */
export function layoutWatchlist(
  symbols: readonly string[],
  watchlist: { teamId?: string; groups?: readonly WatchlistGroup[] } | null | undefined,
  columnSorted: boolean,
): WatchlistLayout {
  if (!watchlist || watchlist.teamId || columnSorted) return { kind: "flat", symbols };
  const groups = normalizeWatchlistGroups(watchlist.groups, new Set(symbols));
  if (!groups) return { kind: "flat", symbols };
  const grouped = new Set(groups.flatMap((group) => group.symbols));
  const ungrouped = symbols.filter((symbol) => !grouped.has(symbol));
  const rows: WatchlistLayoutRow[] = [];
  if (ungrouped.length > 0) {
    rows.push({ kind: "header", id: UNGROUPED_HEADER_ID });
    for (const symbol of ungrouped) rows.push({ kind: "symbol", symbol });
  }
  for (const group of groups) {
    rows.push({ kind: "header", id: group.id, name: group.name });
    for (const symbol of group.symbols) rows.push({ kind: "symbol", symbol });
  }
  return {
    kind: "grouped",
    symbols: rows.flatMap((row) => row.kind === "symbol" ? [row.symbol] : []),
    rows,
  };
}

export function pruneWatchlistGroups(watchlist: Watchlist, members: readonly string[]): Watchlist {
  if (watchlist.teamId || !watchlist.groups) return watchlist;
  return replaceGroups(watchlist, normalizeWatchlistGroups(watchlist.groups, new Set(members)));
}

/**
 * Puts `symbol` in the named group, creating one at the end when the name
 * is new. An empty name takes it out, and the group goes away with its last
 * symbol. Team lists are left untouched.
 */
export function assignWatchlistSymbolGroup(
  watchlist: Watchlist,
  members: readonly string[],
  symbol: string,
  name: string,
  createId: () => string = createGroupId,
): Watchlist {
  if (watchlist.teamId) return watchlist;
  const memberSet = new Set(members);
  const normalized = normalizeWatchlistGroups(watchlist.groups, memberSet);
  const trimmed = name.trim();
  const base = normalized ?? [];
  if (!memberSet.has(symbol)) return replaceGroups(watchlist, normalized);
  if (!trimmed) {
    if (!base.some((group) => group.symbols.includes(symbol))) return replaceGroups(watchlist, normalized);
    const without = base
      .map((group) => (
        group.symbols.includes(symbol)
          ? { ...group, symbols: group.symbols.filter((entry) => entry !== symbol) }
          : group
      ))
      .filter((group) => group.symbols.length > 0);
    return replaceGroups(watchlist, without.length > 0 ? without : undefined);
  }
  const current = base.find((group) => group.symbols.includes(symbol));
  const target = base.find((group) => group.name.toLowerCase() === trimmed.toLowerCase());
  if (current && target && current.id === target.id) return replaceGroups(watchlist, normalized);
  const without = base
    .map((group) => (
      group.symbols.includes(symbol)
        ? { ...group, symbols: group.symbols.filter((entry) => entry !== symbol) }
        : group
    ))
    .filter((group) => group.symbols.length > 0);
  const destination = without.find((group) => group.name.toLowerCase() === trimmed.toLowerCase());
  const next = destination
    ? without.map((group) => (
      group.id === destination.id ? { ...group, symbols: [...group.symbols, symbol] } : group
    ))
    : [...without, { id: createId(), name: trimmed, symbols: [symbol] }];
  return replaceGroups(watchlist, next);
}
