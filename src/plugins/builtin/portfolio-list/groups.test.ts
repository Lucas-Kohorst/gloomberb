import { describe, expect, test } from "bun:test";
import type { Watchlist, WatchlistGroup } from "../../../types/ticker";
import { assignWatchlistSymbolGroup, layoutWatchlist, pruneWatchlistGroups } from "./groups";

const chips: WatchlistGroup = { id: "chips", name: "Chips", symbols: ["NVDA", "AVGO"] };
const energy: WatchlistGroup = { id: "energy", name: "Energy", symbols: ["XOM"] };

function list(groups?: WatchlistGroup[], teamId?: string): Watchlist {
  return {
    id: "wl",
    name: "Watchlist",
    ...(teamId ? { teamId } : {}),
    ...(groups ? { groups } : {}),
  };
}

function ids() {
  let n = 0;
  return () => `g${n += 1}`;
}

describe("watchlist groups", () => {
  test("keeps the input order when there is nothing to group", () => {
    const symbols = ["MSFT", "AAPL", "NVDA"];
    const absent = layoutWatchlist(symbols, { groups: undefined }, false);
    const empty = layoutWatchlist(symbols, { groups: [] }, false);
    const sorted = layoutWatchlist(symbols, { groups: [chips] }, true);
    const team = layoutWatchlist(symbols, { teamId: "t", groups: [chips] }, false);

    expect(absent).toEqual({ kind: "flat", symbols });
    expect(absent.symbols).toBe(symbols);
    expect(empty.symbols).toBe(symbols);
    expect(sorted.symbols).toBe(symbols);
    expect(team.symbols).toBe(symbols);
  });

  test("leads with ungrouped symbols and then each group, sort off", () => {
    const symbols = ["AAPL", "AVGO", "MSFT", "NVDA", "XOM"];
    const layout = layoutWatchlist(symbols, {
      groups: [chips, { id: "empty", name: "Empty", symbols: [] }, { ...energy, symbols: ["XOM", "GONE"] }],
    }, false);

    expect(layout).toEqual({
      kind: "grouped",
      symbols: ["AAPL", "MSFT", "NVDA", "AVGO", "XOM"],
      rows: [
        { kind: "header", id: "ungrouped" },
        { kind: "symbol", symbol: "AAPL" },
        { kind: "symbol", symbol: "MSFT" },
        { kind: "header", id: "chips", name: "Chips" },
        { kind: "symbol", symbol: "NVDA" },
        { kind: "symbol", symbol: "AVGO" },
        { kind: "header", id: "energy", name: "Energy" },
        { kind: "symbol", symbol: "XOM" },
      ],
    });
  });

  test("keeps a symbol in the earliest group only", () => {
    const layout = layoutWatchlist(
      ["NVDA", "XOM"],
      { groups: [{ ...chips, symbols: ["NVDA"] }, { ...energy, symbols: ["NVDA", "XOM"] }] },
      false,
    );

    expect(layout).toEqual({
      kind: "grouped",
      symbols: ["NVDA", "XOM"],
      rows: [
        { kind: "header", id: "chips", name: "Chips" },
        { kind: "symbol", symbol: "NVDA" },
        { kind: "header", id: "energy", name: "Energy" },
        { kind: "symbol", symbol: "XOM" },
      ],
    });
  });

  test("moves a symbol between groups and drops the group it empties", () => {
    const members = ["NVDA", "AVGO", "XOM"];
    const watchlist = list([chips, energy]);
    const moved = assignWatchlistSymbolGroup(watchlist, members, "XOM", "chips", ids());
    expect(moved.groups).toEqual([
      { id: "chips", name: "Chips", symbols: ["NVDA", "AVGO", "XOM"] },
    ]);

    const created = assignWatchlistSymbolGroup(moved, members, "AVGO", "Banks", ids());
    expect(created.groups).toEqual([
      { id: "chips", name: "Chips", symbols: ["NVDA", "XOM"] },
      { id: "g1", name: "Banks", symbols: ["AVGO"] },
    ]);

    const cleared = assignWatchlistSymbolGroup(created, members, "AVGO", "  ");
    expect(cleared.groups).toEqual([
      { id: "chips", name: "Chips", symbols: ["NVDA", "XOM"] },
    ]);
    expect(assignWatchlistSymbolGroup(cleared, members, "NVDA", "CHIPS")).toBe(cleared);

    const left = assignWatchlistSymbolGroup(list([{ id: "only", name: "Only", symbols: ["NVDA"] }]), members, "NVDA", "");
    expect(left.groups).toBeUndefined();
  });

  test("drops symbols that are no longer on the list and ignores a team list", () => {
    const watchlist = list([chips, energy]);
    const pruned = pruneWatchlistGroups(watchlist, ["XOM"]);
    expect(pruned.groups).toEqual([{ id: "energy", name: "Energy", symbols: ["XOM"] }]);
    expect(pruneWatchlistGroups(pruned, [])).toEqual({ id: "wl", name: "Watchlist" });

    const team = list([chips], "team-1");
    expect(assignWatchlistSymbolGroup(team, ["NVDA"], "NVDA", "Other", ids())).toBe(team);
    expect(layoutWatchlist(["NVDA"], team, false).kind).toBe("flat");
  });
});
