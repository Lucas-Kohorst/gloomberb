/** @jsxImportSource react */
import { Window } from "happy-dom";

const testWindow = new Window({ url: "http://localhost" });
const globals: Record<string, unknown> = {
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  MouseEvent: testWindow.MouseEvent,
  Event: testWindow.Event,
  HTMLElement: testWindow.HTMLElement,
  Node: testWindow.Node,
  requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 8),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
};
for (const [name, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AppProvider,
  PaneInstanceProvider,
} from "../../state/app/context";
import { createStatefulTestPluginRuntime } from "../../test-support/plugin-runtime";
import { createDefaultConfig } from "../../types/config";
import { PluginRenderProvider, usePluginPaneState, usePluginState } from "./index";

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container = null;
});

describe("usePluginState store snapshots", () => {
  test("keeps the same empty-array fallback across an unrelated resume write", () => {
    const runtime = createStatefulTestPluginRuntime();
    const watchlists: string[][] = [];
    const snapshots: unknown[][] = [];
    let setVenue: ((value: string) => void) | null = null;
    container = testWindow.document.createElement("div") as unknown as HTMLElement;
    testWindow.document.body.appendChild(container as unknown as Node);
    root = createRoot(container);

    function HookProbe() {
      const [watchlist] = usePluginState<string[]>("watchlist:v1", []);
      const [watchlistSnapshots] = usePluginState<unknown[]>("watchlistSnapshots:v1", []);
      const [lastVenueScope, setLastVenueScope] = usePluginState<string>(
        "lastVenueScope:v1",
        "all",
      );
      const [venueScope, setVenueScope] = usePluginPaneState<string>(
        "venueScope",
        lastVenueScope,
      );
      watchlists.push(watchlist);
      snapshots.push(watchlistSnapshots);
      setVenue = (next) => {
        setVenueScope(next);
        setLastVenueScope(next);
      };
      return (
        <div>{`${lastVenueScope}|${venueScope}|${watchlist.length}|${watchlistSnapshots.length}`}</div>
      );
    }

    act(() => {
      root!.render(
        <AppProvider config={createDefaultConfig("/tmp/gloomberb-plugin-state-dom")}>
          <PaneInstanceProvider paneId="prediction-markets:main">
            <PluginRenderProvider pluginId="prediction-markets" runtime={runtime}>
              <HookProbe />
            </PluginRenderProvider>
          </PaneInstanceProvider>
        </AppProvider>,
      );
    });
    expect(container?.textContent).toContain("all|all|0|0");
    const initialWatchlist = watchlists[0];
    const initialSnapshots = snapshots[0];
    expect(initialWatchlist).toEqual([]);

    act(() => {
      setVenue?.("kalshi");
    });
    expect(container?.textContent).toContain("kalshi|kalshi|0|0");
    expect(Object.is(watchlists[watchlists.length - 1], initialWatchlist)).toBe(true);
    expect(Object.is(snapshots[snapshots.length - 1], initialSnapshots)).toBe(true);
    expect(runtime.getResumeState("prediction-markets", "lastVenueScope:v1")).toBe("kalshi");
  });
});
