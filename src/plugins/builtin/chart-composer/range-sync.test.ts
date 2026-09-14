import { describe, expect, test } from "bun:test";
import { buildBoundChartPreset } from "./presets";
import {
  chartRangeSyncTickerKey,
  chartRangeSyncWindowDates,
  mergeSyncedChartViewport,
  publishChartRangeSync,
  subscribeChartRangeSync,
  type ChartRangeSyncSubscriber,
  type ChartRangeSyncUpdate,
} from "./range-sync";

function update(overrides: Partial<ChartRangeSyncUpdate> = {}): ChartRangeSyncUpdate {
  return {
    ticker: "AAPL",
    range: "1M",
    interval: "1d",
    originPaneId: "chart:origin",
    ...overrides,
  };
}

describe("chart range sync store", () => {
  test("fans out to same-ticker panes but never the origin or other tickers", () => {
    const received: string[] = [];
    const disposers = [
      subscribeChartRangeSync("AAPL", {
        paneId: "chart:origin",
        apply: () => received.push("origin"),
      }),
      subscribeChartRangeSync("AAPL", {
        paneId: "chart:peer",
        apply: (entry) => received.push(`peer:${entry.range}:${entry.interval}`),
      }),
      subscribeChartRangeSync("MSFT", {
        paneId: "chart:other",
        apply: () => received.push("other"),
      }),
    ];

    try {
      publishChartRangeSync(update());
      expect(received).toEqual(["peer:1M:1d"]);
    } finally {
      for (const dispose of disposers) dispose();
    }
  });

  test("resolves the same ticker across casing and whitespace differences", () => {
    const received: string[] = [];
    const dispose = subscribeChartRangeSync(" aapl ", {
      paneId: "chart:peer",
      apply: () => received.push("peer"),
    });

    try {
      expect(chartRangeSyncTickerKey(" aapl ")).toBe(chartRangeSyncTickerKey("AAPL"));
      publishChartRangeSync(update({ ticker: "aapl" }));
      expect(received).toEqual(["peer"]);
    } finally {
      dispose();
    }
  });

  test("stops delivering once a pane unsubscribes", () => {
    const received: string[] = [];
    const dispose = subscribeChartRangeSync("AAPL", {
      paneId: "chart:peer",
      apply: () => received.push("peer"),
    });
    publishChartRangeSync(update());
    dispose();
    publishChartRangeSync(update({ range: "1Y" }));
    expect(received).toHaveLength(1);
  });

  test("drops publishes raised while applying so applies never echo back", () => {
    const seen: string[] = [];
    const disposers = [
      subscribeChartRangeSync("AAPL", {
        paneId: "chart:a",
        apply: (entry) => {
          seen.push(`a:${entry.range}`);
          // An apply that re-publishes must be swallowed by the reentrancy guard.
          publishChartRangeSync(update({ range: "1Y", originPaneId: "chart:a" }));
        },
      }),
      subscribeChartRangeSync("AAPL", {
        paneId: "chart:b",
        apply: (entry) => seen.push(`b:${entry.range}`),
      }),
    ];

    try {
      publishChartRangeSync(update({ originPaneId: "chart:origin", range: "1M" }));
      expect(seen).toEqual(["a:1M", "b:1M"]);
    } finally {
      for (const dispose of disposers) dispose();
    }
  });

  test("keeps fanning out when one subscriber throws", () => {
    const received: string[] = [];
    const disposers = [
      subscribeChartRangeSync("AAPL", {
        paneId: "chart:broken",
        apply: () => {
          throw new Error("apply failed");
        },
      }),
      subscribeChartRangeSync("AAPL", {
        paneId: "chart:peer",
        apply: () => received.push("peer"),
      }),
    ];

    try {
      expect(() => publishChartRangeSync(update())).not.toThrow();
      expect(received).toEqual(["peer"]);
    } finally {
      for (const dispose of disposers) dispose();
    }
  });
});

describe("mergeSyncedChartViewport", () => {
  function specWith(viewport: Partial<ChartSpec["viewport"]>) {
    const base = buildBoundChartPreset("AAPL");
    return { ...base, viewport: { ...base.viewport, ...viewport } } satisfies ChartSpec;
  }

  test("returns null when the pane already matches the update", () => {
    const spec = specWith({ range: "1M", resolution: "1d" });
    expect(mergeSyncedChartViewport(spec, update())).toBeNull();
  });

  test("mirrors a toolbar range change by clearing authored windows and caps", () => {
    const spec = specWith({
      range: "5Y",
      resolution: "auto",
      dateWindow: { start: "2025-01-01", end: "2025-06-30" },
      maxPoints: 250,
    });
    const merged = mergeSyncedChartViewport(spec, update({ range: "1M", interval: "auto" }));
    expect(merged?.viewport).toMatchObject({ range: "1M", resolution: "auto" });
    expect(merged?.viewport.dateWindow).toBeUndefined();
    expect(merged?.viewport.maxPoints).toBeUndefined();
    // Unrelated authored choices survive the merge.
    expect(merged?.series).toEqual(spec.series);
  });

  test("keeps an authored date window for an interval-only change", () => {
    const spec = specWith({
      range: "1M",
      resolution: "auto",
      dateWindow: { start: "2025-01-01", end: "2025-06-30" },
    });
    const merged = mergeSyncedChartViewport(spec, update({ range: "1M", interval: "1wk" }));
    expect(merged?.viewport).toMatchObject({ range: "1M", resolution: "1wk" });
    expect(merged?.viewport.dateWindow).toEqual({ start: "2025-01-01", end: "2025-06-30" });
  });
});

describe("chartRangeSyncWindowDates", () => {
  test("parses valid windows and rejects unordered or invalid ones", () => {
    expect(chartRangeSyncWindowDates({
      start: "2025-01-01T00:00:00.000Z",
      end: "2025-06-30T00:00:00.000Z",
    })).toEqual({
      start: new Date("2025-01-01T00:00:00.000Z"),
      end: new Date("2025-06-30T00:00:00.000Z"),
    });
    expect(chartRangeSyncWindowDates({
      start: "2025-06-30T00:00:00.000Z",
      end: "2025-01-01T00:00:00.000Z",
    })).toBeNull();
    expect(chartRangeSyncWindowDates({ start: "not-a-date", end: "2025-06-30T00:00:00.000Z" })).toBeNull();
  });
});
