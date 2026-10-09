import {
  buildMetricTreemap,
  buildMetricTreemapRects,
  type MetricTreemapLayoutMode,
  type MetricTreemapLayoutOptions,
} from "../../../components/metric-treemap/layout";
import type { HeatmapBoardAsset } from "./portfolio";

/** Not a symbol. One remainder box per board. */
export const HEATMAP_REST_ID = "heatmap:rest";

/**
 * Tiles thinner than this are the clipped slivers on the portfolio map.
 * The surface then lays this folded set out at its own, smaller minimum.
 */
const FOLD_MIN: Record<MetricTreemapLayoutMode, MetricTreemapLayoutOptions> = {
  float: { minTileWidth: 5, minTileHeight: 2.2 },
  integer: { minTileWidth: 4, minTileHeight: 2 },
};

/** Draw every tile. Used when folding again would only reproduce the same box. */
export const HEATMAP_RELAXED_LAYOUT: MetricTreemapLayoutOptions = {
  minTileWidth: 0,
  minTileHeight: 0,
};

export interface HeatmapRestGroup {
  assets: HeatmapBoardAsset[];
  /** Sum of the tile weights, so the box takes the area those names would have. */
  weight: number;
  size: number;
  sizeCurrency: string;
  hasChange: boolean;
  /** Cap-weighted average of the session moves. */
  changePercent: number;
}

export type HeatmapBoardEntry =
  | { kind: "asset"; asset: HeatmapBoardAsset }
  | { kind: "rest"; group: HeatmapRestGroup };

export function heatmapEntryId(entry: HeatmapBoardEntry): string {
  return entry.kind === "asset" ? entry.asset.symbol : HEATMAP_REST_ID;
}

export function heatmapRestGroup(assets: readonly HeatmapBoardAsset[]): HeatmapRestGroup {
  let size = 0;
  let weight = 0;
  let changedSize = 0;
  let weightedChange = 0;
  let sizeCurrency = assets[0]?.sizeCurrency ?? assets[0]?.currency ?? "USD";
  let currencyFromSize = false;
  for (const asset of assets) {
    weight += Math.max(asset.weight ?? 0, 0);
    if (asset.size != null && asset.size > 0) {
      size += asset.size;
      if (!currencyFromSize && asset.sizeCurrency) {
        sizeCurrency = asset.sizeCurrency;
        currencyFromSize = true;
      }
    }
    if (!asset.hasChange || !Number.isFinite(asset.changePercent)) continue;
    if (asset.size == null || asset.size <= 0) continue;
    changedSize += asset.size;
    weightedChange += asset.size * asset.changePercent;
  }
  return {
    assets: assets.slice(),
    weight: weight > 0 ? weight : assets.length,
    size,
    sizeCurrency,
    hasChange: changedSize > 0,
    changePercent: changedSize > 0 ? weightedChange / changedSize : 0,
  };
}

function assetEntry(asset: HeatmapBoardAsset): HeatmapBoardEntry {
  return { kind: "asset", asset };
}

function entryWeight(entry: HeatmapBoardEntry): number {
  if (entry.kind === "rest") return entry.group.weight;
  return entry.asset.weight ?? entry.asset.size ?? 0;
}

export interface HeatmapFoldLayout {
  width: number;
  height: number;
  cellAspect: number;
  mode: MetricTreemapLayoutMode;
}

/** Ids the treemap can actually draw at the fold minimum. */
export function placeHeatmapEntries(
  entries: readonly HeatmapBoardEntry[],
  layout: HeatmapFoldLayout,
): Set<string> {
  const items = entries.map((entry) => ({
    id: heatmapEntryId(entry),
    label: heatmapEntryId(entry),
    weight: entryWeight(entry),
    data: entry,
  }));
  const options = FOLD_MIN[layout.mode];
  const tiles = layout.mode === "float"
    ? buildMetricTreemapRects(items, layout.width, layout.height, layout.cellAspect, options)
    : buildMetricTreemap(items, layout.width, layout.height, layout.cellAspect, options);
  return new Set(tiles.map((tile) => tile.item.id));
}

/**
 * Names the layout cannot draw become one box. If that box itself would not
 * draw, the next-smallest shown name joins it until the box draws or it is
 * the whole board. Assets are largest-first, which is the order the layout
 * drops from.
 */
export function heatmapBoardEntries(
  assets: readonly HeatmapBoardAsset[],
  place: (entries: readonly HeatmapBoardEntry[]) => ReadonlySet<string>,
): HeatmapBoardEntry[] {
  if (assets.length <= 1) return assets.map(assetEntry);

  let shown = assets.slice();
  let hidden: HeatmapBoardAsset[] = [];

  for (let step = 0; step < assets.length; step += 1) {
    const trial = hidden.length === 0
      ? shown.map(assetEntry)
      : [...shown.map(assetEntry), { kind: "rest" as const, group: heatmapRestGroup(hidden) }];
    const placed = place(trial);
    const missed = shown.filter((asset) => !placed.has(asset.symbol));
    const restPlaced = hidden.length === 0 || placed.has(HEATMAP_REST_ID);
    if (missed.length === 0 && restPlaced) {
      return trial.filter((entry) => placed.has(heatmapEntryId(entry)));
    }

    const absorb = missed.length > 0 ? missed : shown.slice(-1);
    if (absorb.length === 0) break;
    const absorbIds = new Set(absorb.map((asset) => asset.symbol));
    hidden = [...hidden, ...absorb];
    shown = shown.filter((asset) => !absorbIds.has(asset.symbol));
    if (shown.length === 0) return [{ kind: "rest", group: heatmapRestGroup(hidden) }];
  }

  return assets.map(assetEntry);
}

/** Clicking the only box on the board should show the names, not the same box. */
export function unfoldEntireRest(
  assets: readonly HeatmapBoardAsset[],
  entries: readonly HeatmapBoardEntry[],
): boolean {
  return entries.length === 1
    && entries[0]?.kind === "rest"
    && entries[0].group.assets.length === assets.length
    && assets.length > 1;
}
