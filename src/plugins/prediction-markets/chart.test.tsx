import { afterEach, describe, expect, test } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createOpenTuiTestRoot as createRoot } from "../../renderers/opentui/test-utils";
import { act, useEffect, useReducer, useRef, useState } from "react";
import {
  AppContext,
  PaneInstanceProvider,
  appReducer,
  createInitialState,
} from "../../state/app/context";
import { createDefaultConfig } from "../../types/config";
import { getNativeSurfaceManager } from "../../components/chart/native/surface/manager";
import { librarySafeTicker } from "../builtin/chart-composer/charting-library-feed";
import { PredictionMarketChart, predictionLibraryInterval, predictionLibrarySymbol } from "./chart";
import type { PredictionHistoryRange } from "./types";

const MINUTE_MS = 60_000;

function timesEvery(gapMs: number, count = 8, start = Date.UTC(2026, 3, 1)): number[] {
  return Array.from({ length: count }, (_, index) => start + index * gapMs);
}

describe("prediction library interval", () => {
  test("follows the median bar gap instead of the range tab", () => {
    expect(predictionLibraryInterval(timesEvery(60 * MINUTE_MS))).toBe("60");
    expect(predictionLibraryInterval(timesEvery(15 * MINUTE_MS))).toBe("15");
    expect(predictionLibraryInterval(timesEvery(5 * MINUTE_MS))).toBe("5");
    expect(predictionLibraryInterval(timesEvery(24 * 60 * MINUTE_MS))).toBe("D");
    expect(predictionLibraryInterval(timesEvery(MINUTE_MS))).toBe("1");
    expect(predictionLibraryInterval(timesEvery(30 * MINUTE_MS))).toBe("30");
    expect(predictionLibraryInterval(timesEvery(45 * MINUTE_MS))).toBe("45");
    expect(predictionLibraryInterval(timesEvery(4 * 60 * MINUTE_MS))).toBe("240");
    expect(predictionLibraryInterval(timesEvery(7 * 24 * 60 * MINUTE_MS))).toBe("W");
    expect(predictionLibraryInterval(timesEvery(30 * 24 * 60 * MINUTE_MS))).toBe("M");
    expect(predictionLibraryInterval([])).toBe("D");
    expect(predictionLibraryInterval([Date.UTC(2026, 3, 1)])).toBe("D");
    expect(predictionLibraryInterval([Date.UTC(2026, 3, 1), Date.UTC(2026, 3, 1)])).toBe("D");
  });

  test("uses the median, so one wide gap does not set the interval", () => {
    const start = Date.UTC(2026, 3, 1);
    const day = 24 * 60 * MINUTE_MS;
    const times = [
      start,
      start + 5 * MINUTE_MS,
      start + 5 * MINUTE_MS + 7 * day,
      start + 10 * MINUTE_MS + 7 * day,
    ];
    expect(predictionLibraryInterval(times)).toBe("5");
  });

  test("the first matching max gap wins", () => {
    const start = Date.UTC(2026, 3, 1);
    expect(predictionLibraryInterval([start, start + 90_000])).toBe("1");
    expect(predictionLibraryInterval([start, start + 90_001])).toBe("5");
    expect(predictionLibraryInterval([start, start + 360_000])).toBe("5");
    expect(predictionLibraryInterval([start, start + 1_200_000])).toBe("15");
    expect(predictionLibraryInterval([start, start + 2_400_000])).toBe("30");
    expect(predictionLibraryInterval([start, start + 3_000_000])).toBe("45");
    expect(predictionLibraryInterval([start, start + 5_400_000])).toBe("60");
    expect(predictionLibraryInterval([start, start + 18_000_000])).toBe("240");
    expect(predictionLibraryInterval([start, start + 172_800_000])).toBe("D");
    expect(predictionLibraryInterval([start, start + 1_209_600_000])).toBe("W");
    expect(predictionLibraryInterval([start, start + 1_209_600_001])).toBe("M");
  });
});

describe("prediction library symbol", () => {
  test("rewrites Kalshi hyphens so the library does not parse a spread", () => {
    expect(predictionLibrarySymbol("kalshi:KXHIGHNY-26OCT02-T70", [1, 2])).toBe(
      "KALSHI:KXHIGHNY_26OCT02_T70",
    );
  });

  test("falls back to history identity instead of YES", () => {
    const times = [1_700_000_000_000, 1_700_003_600_000, 1_700_007_200_000];
    const symbol = predictionLibrarySymbol(undefined, times);
    expect(symbol).not.toBe("YES");
    expect(symbol).toBe(librarySafeTicker(`H${times.length}_${times[0]}_${times[2]}`));
    expect(predictionLibrarySymbol("", times)).toBe(symbol);
    expect(predictionLibrarySymbol("   ", times)).toBe(symbol);
    expect(predictionLibrarySymbol(undefined, times)).toBe(symbol);
    expect(predictionLibrarySymbol(undefined, [...times, times[2]! + 60_000])).not.toBe(symbol);
    expect(predictionLibrarySymbol("---", times)).toBe(symbol);
  });

  test("keeps the market symbol when only the history changes", () => {
    expect(predictionLibrarySymbol("polymarket:abc-def", [1])).toBe("POLYMARKET:ABC_DEF");
    expect(predictionLibrarySymbol("polymarket:abc-def", [1, 2, 3])).toBe("POLYMARKET:ABC_DEF");
  });
});

const TEST_PANE_ID = "prediction-scroll:test";

let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
let root: ReturnType<typeof createRoot> | undefined;
let scrollBoxRef: ScrollBoxRenderable | null = null;
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function ChartScrollHarness() {
  const [state, dispatch] = useReducer(
    appReducer,
    (() => {
      const config = createDefaultConfig("/tmp/gloomberb-test");
      config.chartPreferences.renderer = "kitty";
      const initial = createInitialState(config);
      initial.focusedPaneId = TEST_PANE_ID;
      return initial;
    })(),
  );
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  useEffect(() => {
    scrollBoxRef = scrollRef.current;
  });

  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <scrollbox ref={scrollRef} height={10} scrollY>
          <box flexDirection="column">
            <box height={14}>
              <text>filler</text>
            </box>
            <PredictionMarketChart
              history={[
                { date: new Date("2026-04-01T00:00:00Z"), close: 0.45 },
                { date: new Date("2026-04-02T00:00:00Z"), close: 0.48 },
                { date: new Date("2026-04-03T00:00:00Z"), close: 0.51 },
                { date: new Date("2026-04-04T00:00:00Z"), close: 0.49 },
              ]}
              width={60}
              height={12}
              range="1M"
              onRangeSelect={() => {}}
            />
          </box>
        </scrollbox>
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function flushFrames(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
      await testSetup!.renderOnce();
    });
  }
}

afterEach(() => {
  scrollBoxRef = null;
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = undefined;
  }
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("PredictionMarketChart kitty scrolling", () => {
  test("range shortcuts and pointer tabs do not consume crosshair arrow keys", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const ranges: PredictionHistoryRange[] = [];
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-chart-keys"));
    let setWidth!: (width: number) => void;
    function Harness() {
      const [width, updateWidth] = useState(60);
      setWidth = updateWidth;
      const [range, setRange] = useState<PredictionHistoryRange>("1M");
      return (
        <AppContext value={{ state, dispatch: () => {} }}>
          <PredictionMarketChart
            history={[
              { date: new Date("2026-04-01T00:00:00Z"), close: 0.45 },
              { date: new Date("2026-04-02T00:00:00Z"), close: 0.48 },
              { date: new Date("2026-04-03T00:00:00Z"), close: 0.51 },
            ]}
            width={width}
            height={12}
            focused
            range={range}
            onRangeSelect={(value) => { ranges.push(value); setRange(value); }}
          />
        </AppContext>
      );
    }
    testSetup = await createTestRenderer({ width: 60, height: 12 });
    root = createRoot(testSetup.renderer);
    act(() => { root!.render(<Harness />); });
    await flushFrames();
    await act(async () => {
      testSetup!.mockInput.pressArrow("left");
      testSetup!.mockInput.pressArrow("right");
    });
    await flushFrames();
    expect(ranges).toEqual([]);
    await act(async () => { testSetup!.mockInput.pressKey("1"); });
    await flushFrames();
    expect(ranges).toEqual(["1D"]);
    await act(async () => { setWidth(24); testSetup!.resize(24, 12); });
    await flushFrames();
    expect(testSetup.captureCharFrame().split("\n")[1]).toContain("0.510");
    const row = testSetup.captureCharFrame().split("\n")[0]!;
    const all = row.indexOf("4:ALL");
    expect(all).toBeGreaterThanOrEqual(0);
    await act(async () => { await testSetup!.mockMouse.click(all + 1, 0); });
    await flushFrames();
    expect(ranges).toEqual(["1D", "ALL"]);
  });

  test("creates a native chart surface when scrolled into view", async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 100, height: 24 });
    // multiplexer: "none" keeps the simulated kitty terminal hermetic when the
    // test itself runs inside tmux (the multiplexer guard reads the env).
    (testSetup.renderer as unknown as { _capabilities: unknown })._capabilities = {
      kitty_graphics: true,
      multiplexer: "none",
    };
    (testSetup.renderer as unknown as { _resolution: unknown })._resolution = {
      width: 1000,
      height: 720,
    };

    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(<ChartScrollHarness />);
    });

    await flushFrames();

    const manager = getNativeSurfaceManager(testSetup.renderer as never) as unknown as {
      surfaces: Map<
        string,
        {
          snapshot: {
            paneId: string;
            visibleRect: { x: number; y: number; width: number; height: number } | null;
          };
        }
      >;
    };

    const findPredictionSurface = () => [...manager.surfaces.values()]
      .find((surface) => surface.snapshot.paneId === TEST_PANE_ID);
    const hiddenSurface = findPredictionSurface();
    expect(hiddenSurface).toBeUndefined();

    act(() => {
      scrollBoxRef!.scrollTop = 14;
    });

    await flushFrames();

    const visibleSurface = findPredictionSurface();
    expect(visibleSurface).toBeDefined();
    expect(visibleSurface?.snapshot.visibleRect).not.toBeNull();
    expect(testSetup.captureCharFrame()).toContain("1M");
  });
});
