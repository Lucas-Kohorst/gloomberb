/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { setSharedRegistryForTests, type PluginRegistry } from "../../registry";
import { ChartingLibraryFrame } from "./charting-library-frame";
import type { LibraryDatafeed } from "./charting-library-feed";

test("a chart remount ignores the removed widget's readiness and starts the replacement", async () => {
  const window = new Window({ url: "http://localhost" });
  const previous = { window: globalThis.window, document: globalThis.document, MutationObserver: globalThis.MutationObserver, IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true });
  let killWindow = false;
  const contentWindow = Object.getOwnPropertyDescriptor(window.HTMLIFrameElement.prototype, "contentWindow");
  Object.defineProperty(window.HTMLIFrameElement.prototype, "contentWindow", {
    configurable: true,
    get() {
      if (killWindow || !this.isConnected) return null;
      return contentWindow?.get?.call(this) ?? null;
    },
  });
  setSharedRegistryForTests({
    getMarketData: () => ({}),
    getConfigState: () => null,
    setConfigState: async () => {},
  } as unknown as PluginRegistry);
  let primaryChanged: ((info: { ticker?: string; name?: string }) => void) | undefined;
  let primaryUnsubscribeCalls = 0;
  let layoutUnsubscribeCalls = 0;
  let teardownThrows = false;
  const selected: Array<{ ticker: string; name: string }> = [];
  const widgets: Array<{ ready: () => void; removed: boolean }> = [];
  const deadWindow = () => {
    throw new TypeError("null is not an object (evaluating 't.doWhenApiIsReady')");
  };
  Object.assign(window, { TradingView: { widget: class {
    state = { ready: () => {}, removed: false };
    iframe = globalThis.document.createElement("iframe");
    constructor(options: { container: HTMLElement }) {
      options.container.appendChild(this.iframe);
      widgets.push(this.state);
    }
    onChartReady(callback: () => void) { this.state.ready = callback; }
    save(callback: (state: object) => void) { callback({ charts: [] }); }
    subscribe() {}
    unsubscribe() {
      layoutUnsubscribeCalls++;
      if (teardownThrows || this.iframe.contentWindow == null) deadWindow();
    }
    activeChart() { return {
      symbolExt: () => ({ ticker: "AAPL", name: "Apple" }),
      onSymbolChanged: () => ({
        subscribe: (_owner: null, callback: typeof primaryChanged) => { primaryChanged = callback; },
        unsubscribe: () => {
          primaryUnsubscribeCalls++;
          if (teardownThrows || this.iframe.contentWindow == null) deadWindow();
        },
      }),
    }; }
    remove() { this.state.removed = true; this.iframe.remove(); }
  } } });
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  let readyCount = 0;
  const chart = (key: string) => <ChartingLibraryFrame key={key} symbol="AAPL" interval="240" timezone="America/New_York" compares={[]} chartStyle="heikinashi" backgroundColor="#000000" feed={{} as LibraryDatafeed} onReady={() => { readyCount++; }} onPrimarySymbolChange={(info) => selected.push(info)} />;
  try {
    await act(async () => { root.render(chart("first")); });
    expect(container.textContent).toContain("Loading chart");
    await act(async () => { widgets[0]?.ready(); });
    expect(readyCount).toBe(1);
    await act(async () => { root.render(null); });
    expect(widgets[0]?.removed).toBe(true);
    expect(primaryUnsubscribeCalls).toBe(1);
    expect(layoutUnsubscribeCalls).toBe(1);
    await act(async () => { root.render(chart("second")); });
    await act(async () => { widgets[0]?.ready(); });
    expect(readyCount).toBe(1);
    expect(container.textContent).toContain("Loading chart");
    await act(async () => { widgets[1]?.ready(); });
    expect(readyCount).toBe(2);
    expect(container.textContent).not.toContain("Loading chart");
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(selected).toEqual([
      { ticker: "AAPL", name: "Apple" },
      { ticker: "AAPL", name: "Apple" },
    ]);
    await act(async () => { primaryChanged?.({ ticker: "NVDA", name: "Nvidia" }); });
    await act(async () => { primaryChanged?.({ ticker: "GDP", name: "GDP" }); });
    await act(async () => { primaryChanged?.({ ticker: "KX", name: "Kalshi" }); });
    expect(selected).toEqual([
      { ticker: "AAPL", name: "Apple" },
      { ticker: "AAPL", name: "Apple" },
      { ticker: "NVDA", name: "Nvidia" },
      { ticker: "GDP", name: "GDP" },
      { ticker: "KX", name: "Kalshi" },
    ]);
    expect(widgets).toHaveLength(2);
    teardownThrows = true;
    await act(async () => { root.render(null); });
    expect(primaryUnsubscribeCalls).toBe(2);
    expect(layoutUnsubscribeCalls).toBe(2);
    expect(widgets[1]?.removed).toBe(true);
    teardownThrows = false;
    await act(async () => { root.render(chart("third")); });
    await act(async () => { widgets[2]?.ready(); });
    killWindow = true;
    await act(async () => { root.unmount(); });
    expect(primaryUnsubscribeCalls).toBe(3);
    expect(layoutUnsubscribeCalls).toBe(3);
    expect(widgets[2]?.removed).toBe(true);
  } finally {
    setSharedRegistryForTests(undefined);
    if (contentWindow) Object.defineProperty(window.HTMLIFrameElement.prototype, "contentWindow", contentWindow);
    if (container.isConnected) await act(async () => { root.unmount(); });
    Object.assign(globalThis, previous);
    await window.happyDOM.close();
  }
});
