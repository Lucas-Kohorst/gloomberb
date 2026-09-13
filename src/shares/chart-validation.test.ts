import { expect, test } from "bun:test";
import { chartShareFromStored, parseChartSharePayload, parseSharePayload } from "./payload";

const data = { title: "Prices", series: [{ name: "AAPL", points: [{ x: 1, y: 2 }] }] };

test("rejects malformed stored chart metadata before conversion", () => {
  for (const metadata of [
    { panels: "bad" }, { panels: [null] }, { panels: [{ id: "p", height: "big" }] },
    { panels: [{ id: "p", scale: "bad" }] }, { capturedAt: {} },
    { window: { start: 1, end: "bad" } }, { spec: { panels: "bad" } },
  ]) expect(parseSharePayload({ kind: "chart", data: { ...data, ...metadata } })).toBeNull();
  for (const metadata of [{ unit: {} }, { color: [] }, { style: "bad" }, { axis: "bad" }, { panelId: {} }]) {
    expect(parseSharePayload({ kind: "chart", data: { ...data, series: [{ ...data.series[0], ...metadata }] } })).toBeNull();
  }
  for (const key of ["o", "h", "l", "c"]) {
    expect(parseSharePayload({ kind: "chart", data: { ...data, series: [{ ...data.series[0], points: [{ x: 1, y: 2, [key]: "bad" }] }] } })).toBeNull();
  }
});

test("legacy charts convert and rich page charts validate at the boundary", () => {
  const parsed = parseSharePayload({ kind: "chart", data });
  expect(parsed?.kind).toBe("chart");
  const page = chartShareFromStored(data);
  expect(parseChartSharePayload(page)).not.toBeNull();
  expect(parseChartSharePayload({ ...page, panels: [null] })).toBeNull();
  expect(parseChartSharePayload({ ...page, series: [{ ...page.series[0], points: [{ t: 1, c: {} }] }] })).toBeNull();
});
