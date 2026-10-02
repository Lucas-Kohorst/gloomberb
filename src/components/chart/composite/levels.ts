import type { ChartVectorShape } from "../../../ui/host";
import type { NativeChartBitmap } from "../native/chart-rasterizer";
import { drawLine, parseHex } from "../native/raster/primitives";
import { projectCompositeValue } from "./scene";
import type { CompositeAxisDomain } from "./types";

/** A horizontal price level across the plot. */
export interface CompositeChartLevel {
  id: string;
  value: number;
  color: string;
  /** False for a level the chart shows but something else owns, such as a price alert. */
  editable: boolean;
}

export interface ProjectedLevel {
  level: CompositeChartLevel;
  yRatio: number;
}

/** Levels inside the axis range. */
export function projectLevels(
  items: readonly CompositeChartLevel[],
  domain: CompositeAxisDomain,
): ProjectedLevel[] {
  return items.flatMap((level) => {
    const yRatio = projectCompositeValue(level.value, domain);
    return yRatio === null || yRatio < 0 || yRatio > 1 ? [] : [{ level, yRatio }];
  });
}

export function levelVectors(levels: readonly ProjectedLevel[]): ChartVectorShape[] {
  return levels.map(({ level, yRatio }) => ({
    id: `level:${level.id}`,
    points: [{ x: 0, y: yRatio }, { x: 1, y: yRatio }],
    color: level.color,
    strokeWidth: 1.2,
  }));
}

/** Levels painted on a copy of the panel raster, the layer the terminal uploads. */
export function paintLevels(
  base: NativeChartBitmap,
  levels: readonly ProjectedLevel[],
): NativeChartBitmap {
  if (levels.length === 0) return base;
  const data = new Uint8Array(base.pixels);
  const maxX = Math.max(base.width - 1, 0);
  const maxY = Math.max(base.height - 1, 0);
  for (const { level, yRatio } of levels) {
    const y = Math.round(yRatio * maxY);
    drawLine(data, base.width, base.height, 0, y, maxX, y, parseHex(level.color), 1.2);
  }
  return { width: base.width, height: base.height, pixels: data };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Levels in the terminal text plot, written into blank cells so they read as
 * running under the marks: `─` drawn here, `┄` owned elsewhere (an alert).
 */
export function writeLevelText(lines: readonly string[], levels: readonly ProjectedLevel[]): string[] {
  if (levels.length === 0 || lines.length === 0) return [...lines];
  const rows = lines.map((line) => Array.from(line));
  for (const { level, yRatio } of levels) {
    const row = rows[clamp(Math.round(yRatio * (rows.length - 1)), 0, rows.length - 1)]!;
    const glyph = level.editable ? "─" : "┄";
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === " " || row[x] === "·" || row[x] === "╌") row[x] = glyph;
    }
  }
  return rows.map((row) => row.join(""));
}
