import { expect, test } from "bun:test";
import type { CompositeAxisDomain } from "./types";
import { levelVectors, paintLevels, projectLevels, writeLevelText, type CompositeChartLevel } from "./levels";

const domain: CompositeAxisDomain = {
  side: "right",
  min: 0,
  max: 100,
  scale: "linear",
  unit: "USD",
  unitGroup: "price:USD",
  seriesIds: ["px"],
};

function level(id: string, value: number, editable = true): CompositeChartLevel {
  return { id, value, color: "#f5a524", editable };
}

test("a level projects onto its axis and becomes a line across the plot", () => {
  const projected = projectLevels([
    level("on", 100),
    level("mid", 50),
    level("off", 150),
  ], domain);
  expect(projected.map((entry) => [entry.level.id, entry.yRatio])).toEqual([
    ["on", 0],
    ["mid", 0.5],
  ]);
  const [line] = levelVectors(projected.filter((entry) => entry.level.id === "mid"));
  expect(line).toEqual({
    id: "level:mid",
    points: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
    color: "#f5a524",
    strokeWidth: 1.2,
  });
});

test("text levels fill only blank cells so the marks stay readable", () => {
  const lines = writeLevelText(
    ["  ·  ", " •█· ", "     "],
    [
      { level: level("drawn", 50), yRatio: 0.5 },
      { level: level("alert", 0, false), yRatio: 1 },
    ],
  );
  expect(lines).toEqual(["  ·  ", "─•█──", "┄┄┄┄┄"]);
});

test("painting a level writes the line into the raster and leaves the source bitmap alone", () => {
  const base = { width: 4, height: 3, pixels: new Uint8Array(4 * 3 * 4) };
  const painted = paintLevels(base, [{ level: level("mid", 50), yRatio: 0.5 }]);
  expect(painted).not.toBe(base);
  expect(base.pixels.every((channel) => channel === 0)).toBe(true);
  const row = 1;
  let ink = 0;
  for (let x = 0; x < base.width; x += 1) ink += painted.pixels[(row * base.width + x) * 4 + 3] ?? 0;
  expect(ink).toBeGreaterThan(0);
  expect(paintLevels(base, [])).toBe(base);
});
