import { expect, test } from "bun:test";
import type { HeatmapBoardAsset } from "./portfolio";
import {
  HEATMAP_REST_ID,
  heatmapBoardEntries,
  heatmapEntryId,
  heatmapRestGroup,
  placeHeatmapEntries,
  unfoldEntireRest,
  type HeatmapBoardEntry,
} from "./remainder";

function asset(patch: Partial<HeatmapBoardAsset> & { symbol: string }): HeatmapBoardAsset {
  return {
    symbol: patch.symbol,
    name: patch.symbol,
    price: 1,
    change: 0,
    changePercent: 0,
    hasChange: false,
    size: null,
    sizeKind: "market-cap",
    volume: null,
    currency: "USD",
    exchange: "X",
    sector: null,
    industry: null,
    marketState: null,
    source: "gloom",
    ...patch,
  };
}

function ids(entries: readonly HeatmapBoardEntry[]): string[] {
  return entries.map(heatmapEntryId);
}

function placeByWeight(minAsset: number, minRest: number) {
  return (entries: readonly HeatmapBoardEntry[]) => {
    const placed = new Set<string>();
    for (const entry of entries) {
      const weight = entry.kind === "asset" ? (entry.asset.weight ?? 0) : entry.group.weight;
      const min = entry.kind === "asset" ? minAsset : minRest;
      if (weight >= min) placed.add(heatmapEntryId(entry));
    }
    return placed;
  };
}

test("names that miss the tile minimum become one box colored by their cap-weighted move", () => {
  const assets = [
    asset({ symbol: "NVDA", weight: 1000, size: 5000, hasChange: true, changePercent: 1 }),
    asset({ symbol: "A", weight: 6, size: 1, hasChange: true, changePercent: 10 }),
    asset({ symbol: "B", weight: 5, size: 1, hasChange: true, changePercent: -4 }),
  ];
  const entries = heatmapBoardEntries(assets, placeByWeight(10, 10));
  expect(ids(entries)).toEqual(["NVDA", HEATMAP_REST_ID]);
  const rest = entries[1];
  if (rest?.kind !== "rest") throw new Error("expected a remainder box");
  expect(rest.group.assets.map((row) => row.symbol)).toEqual(["A", "B"]);
  expect(rest.group.size).toBe(2);
  expect(rest.group.changePercent).toBe(3);
  expect(rest.group.hasChange).toBe(true);
});

test("a name with no session change is left out of the box color and still counts in the cap", () => {
  const group = heatmapRestGroup([
    asset({ symbol: "A", weight: 6, size: 1, hasChange: true, changePercent: 10 }),
    asset({ symbol: "B", weight: 5, size: 1, hasChange: false, changePercent: -4 }),
  ]);
  expect(group.changePercent).toBe(10);
  expect(group.size).toBe(2);
  expect(group.assets).toHaveLength(2);
});

test("the box absorbs the next shown name until its own tile would draw", () => {
  const assets = [
    asset({ symbol: "BIG", weight: 100, size: 100, hasChange: true, changePercent: 1 }),
    asset({ symbol: "MID", weight: 60, size: 60, hasChange: true, changePercent: 2 }),
    asset({ symbol: "A", weight: 4, size: 1, hasChange: true, changePercent: 10 }),
    asset({ symbol: "B", weight: 4, size: 1, hasChange: true, changePercent: -4 }),
    asset({ symbol: "C", weight: 4, size: 1, hasChange: true, changePercent: 0 }),
  ];
  const entries = heatmapBoardEntries(assets, placeByWeight(50, 30));
  expect(ids(entries)).toEqual(["BIG", HEATMAP_REST_ID]);
  const rest = entries[1];
  if (rest?.kind !== "rest") throw new Error("expected a remainder box");
  expect(rest.group.assets.map((row) => row.symbol)).toEqual(["A", "B", "C", "MID"]);
  expect(rest.group.weight).toBe(72);
  expect(rest.group.changePercent).toBe(2);
});

test("a board that already fits stays a list of tickers", () => {
  const assets = [
    asset({ symbol: "NVDA", weight: 100, size: 100, hasChange: true, changePercent: 1 }),
    asset({ symbol: "A", weight: 40, size: 40, hasChange: true, changePercent: 1 }),
  ];
  const entries = heatmapBoardEntries(assets, () => new Set(["NVDA", "A"]));
  expect(ids(entries)).toEqual(["NVDA", "A"]);
});

test("one name stays a ticker, and a box of the whole board is marked so the click can open it", () => {
  const solo = [asset({ symbol: "NVDA", weight: 1, size: 1 })];
  expect(heatmapBoardEntries(solo, () => new Set()).map(heatmapEntryId)).toEqual(["NVDA"]);

  const dust = [
    asset({ symbol: "A", weight: 1, size: 1, hasChange: true, changePercent: 1 }),
    asset({ symbol: "B", weight: 1, size: 1, hasChange: true, changePercent: 1 }),
  ];
  const folded = heatmapBoardEntries(dust, () => new Set());
  expect(unfoldEntireRest(dust, folded)).toBe(true);
  expect(unfoldEntireRest(dust, heatmapBoardEntries(dust, () => new Set(["A", "B"])))).toBe(false);
});

test("the real layout keeps a readable tile and folds the slivers into a box that itself draws", () => {
  const assets = [
    asset({ symbol: "NVDA", weight: 1000, size: 1e12, hasChange: true, changePercent: 0.2 }),
    ...Array.from({ length: 20 }, (_, index) => asset({
      symbol: `S${index}`,
      weight: 8,
      size: 64,
      hasChange: true,
      changePercent: index % 2 === 0 ? 1 : -1,
    })),
  ];
  const layout = { width: 40, height: 16, cellAspect: 2, mode: "float" as const };
  const entries = heatmapBoardEntries(assets, (trial) => placeHeatmapEntries(trial, layout));
  const symbols = entries.flatMap((entry) => (
    entry.kind === "asset" ? [entry.asset.symbol] : entry.group.assets.map((row) => row.symbol)
  ));
  expect(symbols.sort()).toEqual(assets.map((row) => row.symbol).sort());
  expect(entries.some((entry) => entry.kind === "asset" && entry.asset.symbol === "NVDA")).toBe(true);
  const rest = entries.find((entry) => entry.kind === "rest");
  if (rest?.kind !== "rest") throw new Error("expected the slivers to fold");
  expect(rest.group.assets.some((row) => row.symbol === "NVDA")).toBe(false);
  expect(rest.group.size).toBe(rest.group.assets.length * 64);
  const placed = placeHeatmapEntries(entries, layout);
  expect(entries.every((entry) => placed.has(heatmapEntryId(entry)))).toBe(true);
});

test("a roomy map does not fold tiles that already draw", () => {
  const assets = [100, 80, 60].map((weight, index) => asset({
    symbol: `N${index}`,
    weight,
    size: weight,
    hasChange: true,
    changePercent: 1,
  }));
  const entries = heatmapBoardEntries(assets, (trial) => placeHeatmapEntries(trial, {
    width: 80,
    height: 24,
    cellAspect: 2,
    mode: "float",
  }));
  expect(ids(entries)).toEqual(["N0", "N1", "N2"]);
});
