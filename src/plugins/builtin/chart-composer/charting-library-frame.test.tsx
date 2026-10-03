/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ChartingLibraryFrame } from "./charting-library-frame";
import type { LibraryDatafeed } from "./charting-library-feed";

test("a chart remount ignores the removed widget's readiness and starts the replacement", async () => {
  const window = new Window({ url: "http://localhost" });
  const previous = { window: globalThis.window, document: globalThis.document, MutationObserver: globalThis.MutationObserver, IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true });
  let primaryChanged: ((info: { ticker?: string; name?: string }) => void) | undefined;
  const selected: string[] = [];
  const widgets: Array<{ ready: () => void; removed: boolean }> = [];
  Object.assign(window, { TradingView: { widget: class {
    state = { ready: () => {}, removed: false };
    constructor(options: { container: HTMLElement }) {
      options.container.appendChild(globalThis.document.createElement("iframe"));
      widgets.push(this.state);
    }
    onChartReady(callback: () => void) { this.state.ready = callback; }
    activeChart() { return {
      symbolExt: () => ({ ticker: "AAPL", name: "Apple" }),
      onSymbolChanged: () => ({
        subscribe: (_owner: null, callback: typeof primaryChanged) => { primaryChanged = callback; },
        unsubscribe: () => { primaryChanged = undefined; },
      }),
    }; }
    remove() { this.state.removed = true; }
  } } });
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  let readyCount = 0;
  const chart = (key: string) => <ChartingLibraryFrame key={key} symbol="AAPL" interval="240" timezone="America/New_York" compares={[]} chartStyle="heikinashi" backgroundColor="#000000" feed={{} as LibraryDatafeed} onReady={() => { readyCount++; }} onPrimarySymbolChange={(info) => selected.push(info.ticker)} />;
  try {
    await act(async () => { root.render(chart("first")); });
    expect(container.textContent).toContain("Loading chart");
    await act(async () => { root.render(null); });
    expect(widgets[0]?.removed).toBe(true);
    await act(async () => { root.render(chart("second")); });
    await act(async () => { widgets[0]?.ready(); });
    expect(readyCount).toBe(0);
    expect(container.textContent).toContain("Loading chart");
    await act(async () => { widgets[1]?.ready(); });
    expect(readyCount).toBe(1);
    expect(container.textContent).not.toContain("Loading chart");
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(selected).toEqual(["AAPL"]);
    await act(async () => { primaryChanged?.({ ticker: "NVDA", name: "Nvidia" }); });
    expect(selected).toEqual(["AAPL", "NVDA"]);
    expect(widgets).toHaveLength(2);
  } finally {
    await act(async () => { root.unmount(); });
    Object.assign(globalThis, previous);
    await window.happyDOM.close();
  }
});
