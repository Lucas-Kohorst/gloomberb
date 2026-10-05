import { expect, test } from "bun:test";
import { chartLayoutKey, persistChartLayout, readChartLayout, type ChartLayoutStore } from "./charting-library-persistence";

test("reopening the same symbol restores studies and drawings independently of other charts", () => {
  const values = new Map<string, unknown>();
  const writes: string[] = [];
  const store: ChartLayoutStore = {
    getConfigState: <T>(_plugin: string, key: string) => (values.get(key) as T) ?? null,
    async setConfigState(_plugin, key, value) { writes.push(key); values.set(key, value); },
  };
  const key = chartLayoutKey("NASDAQ:AAPL", []);
  let autosave: (() => void) | undefined;
  let state: object = { charts: [{ studies: ["SMA"], drawings: [{ price: 100 }] }] };
  const stop = persistChartLayout({
    save: (callback) => callback(state),
    subscribe: (_event, callback) => { autosave = callback; },
    unsubscribe: (_event, callback) => { if (autosave === callback) autosave = undefined; },
  }, store, key, (error) => { throw error; });
  state = { charts: [{ studies: ["SMA"], drawings: [{ price: 101 }] }] };
  autosave?.();
  expect(readChartLayout(store, key)).toEqual(state);
  expect(readChartLayout(store, chartLayoutKey("NASDAQ:MSFT", []))).toBeUndefined();
  autosave?.();
  expect(writes).toHaveLength(1);
  state = { charts: [{ studies: ["SMA", "RSI"], resolution: "240" }] };
  stop();
  expect(autosave).toBeUndefined();
  expect(readChartLayout(store, key)).toEqual(state);
  expect(writes).toHaveLength(2);
});

test("read-only charts never attach autosave and persistence failures are reported", async () => {
  let attached = false;
  let autosave: (() => void) | undefined;
  let snapshot: object = { charts: [] };
  const widget = { save: (callback: (state: object) => void) => callback(snapshot), subscribe: (_event: "onAutoSaveNeeded", callback: () => void) => { attached = true; autosave = callback; } };
  persistChartLayout(widget, undefined, "share", () => {})();
  expect(attached).toBe(false);
  const errors: unknown[] = [];
  const failure = new Error("save failed");
  persistChartLayout(widget, { getConfigState: () => null, setConfigState: async () => { throw failure; } }, "chart", (error) => errors.push(error))();
  snapshot = { charts: ["edited"] };
  autosave?.();
  await Promise.resolve();
  expect(errors).toEqual([failure]);
});

test("an untouched loading chart does not overwrite the data-driven defaults on remount", () => {
  let writes = 0;
  const stop = persistChartLayout({ save: (callback) => callback({ style: "line" }) }, {
    getConfigState: () => null,
    setConfigState: async () => { writes++; },
  }, "loading", () => {});
  stop();
  expect(writes).toBe(0);
});


test("closing immediately after adding an SMA saves before delayed autosave", () => {
  let snapshot: object = { studies: [] };
  let saved: unknown;
  const stop = persistChartLayout({ save: (callback) => callback(snapshot) }, {
    getConfigState: () => null,
    setConfigState: async (_plugin, _key, state) => { saved = state; },
  }, "chart", () => {});
  snapshot = { studies: ["SMA"] };
  stop();
  expect(saved).toEqual(snapshot);
});

test("a dead-window unsubscribe still saves the edited snapshot without reporting", () => {
  let snapshot: object = { studies: [] };
  let saved: unknown;
  const errors: unknown[] = [];
  const stop = persistChartLayout({
    save: (callback) => callback(snapshot),
    unsubscribe: () => { throw new TypeError("null is not an object (evaluating 't.doWhenApiIsReady')"); },
  }, {
    getConfigState: () => null,
    setConfigState: async (_plugin, _key, state) => { saved = state; },
  }, "chart", (error) => { errors.push(error); });
  snapshot = { studies: ["SMA"] };
  stop();
  expect(saved).toEqual(snapshot);
  expect(errors).toEqual([]);
});

test("an unsubscribe failure still saves and is reported", () => {
  let snapshot: object = { studies: [] };
  let saved: unknown;
  const errors: unknown[] = [];
  const failure = new Error("unsubscribe failed");
  const stop = persistChartLayout({
    save: (callback) => callback(snapshot),
    unsubscribe: () => { throw failure; },
  }, {
    getConfigState: () => null,
    setConfigState: async (_plugin, _key, state) => { saved = state; },
  }, "chart", (error) => { errors.push(error); });
  snapshot = { studies: ["edited"] };
  stop();
  expect(saved).toEqual(snapshot);
  expect(errors).toEqual([failure]);
});

test("a dead chart window during dispose save is not reported", () => {
  const errors: unknown[] = [];
  let mounted = true;
  const stop = persistChartLayout({
    save: (callback) => {
      if (!mounted) throw new TypeError("null is not an object (evaluating 'contentWindow.tradingViewApi')");
      callback({ studies: [] });
    },
  }, {
    getConfigState: () => null,
    setConfigState: async () => {},
  }, "chart", (error) => { errors.push(error); });
  mounted = false;
  stop();
  expect(errors).toEqual([]);
});

test("a dispose save failure is reported", () => {
  const errors: unknown[] = [];
  let mounted = true;
  const failure = new Error("save failed");
  const stop = persistChartLayout({
    save: (callback) => {
      if (!mounted) throw failure;
      callback({ studies: [] });
    },
  }, {
    getConfigState: () => null,
    setConfigState: async () => {},
  }, "chart", (error) => { errors.push(error); });
  mounted = false;
  stop();
  expect(errors).toEqual([failure]);
});
