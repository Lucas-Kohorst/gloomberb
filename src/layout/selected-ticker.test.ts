import { expect, test } from "bun:test";
import { createInitialState } from "../core/state/app/state";
import { activeCommandInstrumentLabel } from "../components/command-bar/prompt-placeholder";
import {
  createDefaultConfig,
  createPaneInstance,
  TICKER_RESEARCH_PANE_ID,
  type DockLayoutNode,
  type PaneInstanceConfig,
} from "../types/config";
import { createTestTicker } from "../test-support/ticker";
import { cursorSourceHoldsSymbol, layoutTickerTarget, LINKED_TICKER_MARK, selectedLayoutTicker } from "./selected-ticker";

function dockOf(ids: readonly string[]): DockLayoutNode {
  const [first, ...rest] = ids;
  if (!first) throw new Error("empty dock");
  if (rest.length === 0) return { kind: "pane", instanceId: first };
  return {
    kind: "split",
    axis: "horizontal",
    ratio: 0.5,
    first: { kind: "pane", instanceId: first },
    second: dockOf(rest),
  };
}

function layoutState(instances: PaneInstanceConfig[], focusedPaneId: string | null) {
  const state = createInitialState(createDefaultConfig("/tmp/gloomberb-selected-ticker"));
  state.focusedPaneId = focusedPaneId;
  state.config.layout = {
    dockRoot: dockOf(instances.map((instance) => instance.instanceId)),
    instances,
    floating: [],
    detached: [],
  };
  return state;
}

const isList = (paneType: string) => paneType === "portfolio-list";

test("a linked desk keeps its ticker selected while a market pane is focused", () => {
  const des = createPaneInstance(TICKER_RESEARCH_PANE_ID, {
    instanceId: "des",
    binding: { kind: "fixed", symbol: "MSTR:XMEX" },
  });
  const chart = createPaneInstance("chart-composer", {
    instanceId: "chart",
    binding: { kind: "follow", sourceInstanceId: "des" },
  });
  const financials = createPaneInstance("financial-analysis", {
    instanceId: "fa",
    binding: { kind: "follow", sourceInstanceId: "des" },
  });
  const news = createPaneInstance("news-top", { instanceId: "news", binding: { kind: "none" } });
  const state = layoutState([des, chart, financials, news], "news");

  expect(selectedLayoutTicker(state)).toEqual({
    rootInstanceId: "des",
    symbol: "MSTR:XMEX",
    memberCount: 3,
  });
  expect(activeCommandInstrumentLabel(state)).toBe(`${LINKED_TICKER_MARK} MSTR:XMEX`);
  expect(layoutTickerTarget(state, { isTickerSource: isList })).toEqual({
    kind: "retarget",
    rootInstanceId: "des",
    mode: "research",
    keepFocus: false,
  });
  state.focusedPaneId = "chart";
  expect(layoutTickerTarget(state, { isTickerSource: isList })).toMatchObject({
    kind: "retarget",
    keepFocus: true,
    mode: "research",
  });
});

test("a symbol chosen for a list moves the list cursor when something follows it", () => {
  const list = createPaneInstance("portfolio-list", { instanceId: "list", binding: { kind: "none" } });
  const research = createPaneInstance(TICKER_RESEARCH_PANE_ID, {
    instanceId: "des",
    binding: { kind: "follow", sourceInstanceId: "list" },
  });
  const state = layoutState([list, research], "des");
  state.paneState.list = { cursorSymbol: "NVDA", collectionId: "main" };
  state.tickers.set("NVDA", createTestTicker("NVDA", "NVIDIA", { portfolios: ["main"] }));

  expect(selectedLayoutTicker(state)?.rootInstanceId).toBe("list");
  expect(layoutTickerTarget(state, { isTickerSource: isList, symbol: "NVDA" })).toMatchObject({
    kind: "retarget",
    rootInstanceId: "list",
    mode: "cursor",
    keepFocus: true,
  });
  expect(activeCommandInstrumentLabel(state)).toBe(`${LINKED_TICKER_MARK} NVDA`);
});

test("a symbol the linked list does not hold opens a pane", () => {
  const list = createPaneInstance("portfolio-list", { instanceId: "list", binding: { kind: "none" } });
  const research = createPaneInstance(TICKER_RESEARCH_PANE_ID, {
    instanceId: "des",
    binding: { kind: "follow", sourceInstanceId: "list" },
  });
  const state = layoutState([list, research], "des");
  state.paneState.list = { cursorSymbol: "ZEC/USD", collectionId: "main" };
  state.tickers.set("ZEC/USD", createTestTicker("ZEC/USD", "Zcash", { portfolios: ["main"] }));

  expect(cursorSourceHoldsSymbol(state, "list", "ZEC/USD")).toBe(true);
  expect(cursorSourceHoldsSymbol(state, "list", "RSP")).toBe(false);
  expect(layoutTickerTarget(state, { isTickerSource: isList, symbol: "RSP" })).toEqual({ kind: "open" });
  expect(layoutTickerTarget(state, { isTickerSource: isList, symbol: "ZEC/USD" })).toMatchObject({
    kind: "retarget",
    mode: "cursor",
    rootInstanceId: "list",
  });
});

test("a lone list still opens a pane, and a new pane never retargets", () => {
  const list = createPaneInstance("portfolio-list", { instanceId: "list", binding: { kind: "none" } });
  const state = layoutState([list], "list");
  state.paneState.list = { cursorSymbol: "NVDA" };

  expect(activeCommandInstrumentLabel(state)).toBe("NVDA");
  expect(layoutTickerTarget(state, { isTickerSource: isList })).toEqual({ kind: "open" });
  expect(layoutTickerTarget(state, { forceNewPane: true, isTickerSource: isList })).toEqual({ kind: "open" });
});

test("a focused research pane with no followers is still the ticker that changes", () => {
  const des = createPaneInstance(TICKER_RESEARCH_PANE_ID, {
    instanceId: "des",
    binding: { kind: "fixed", symbol: "AAPL" },
  });
  const news = createPaneInstance("news-top", { instanceId: "news", binding: { kind: "none" } });
  const focused = layoutState([des, news], "des");
  expect(layoutTickerTarget(focused, { isTickerSource: isList })).toMatchObject({
    kind: "retarget",
    mode: "research",
    rootInstanceId: "des",
  });
  focused.focusedPaneId = "news";
  expect(selectedLayoutTicker(focused)).toBeNull();
  expect(activeCommandInstrumentLabel(focused)).toBeNull();
});

test("a market-wide board stays out of the link until it follows a ticker", () => {
  const board = createPaneInstance("catalysts", { instanceId: "catl", binding: { kind: "none" } });
  const news = createPaneInstance("news-top", { instanceId: "news", binding: { kind: "none" } });
  const state = layoutState([board, news], "catl");

  expect(selectedLayoutTicker(state)).toBeNull();
  expect(activeCommandInstrumentLabel(state)).toBeNull();
  expect(layoutTickerTarget(state, { isTickerSource: isList })).toEqual({ kind: "open" });
});
