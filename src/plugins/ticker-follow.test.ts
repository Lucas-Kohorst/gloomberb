import { describe, expect, test } from "bun:test";
import { createInitialState, resolveTickerForPane } from "../core/state/app/state";
import { createDefaultConfig } from "../types/config";
import {
  createPaneInstance,
  type LayoutConfig,
  type PaneInstanceConfig,
} from "../types/config";
import {
  applyTickerRetarget,
  canRetargetPaneTicker,
  currentFollowSourceValue,
  resolveTickerWriteTarget,
  setPaneFollowSource,
  TICKER_FOLLOW_PINNED_VALUE,
  wouldCreateFollowCycle,
} from "./ticker-follow";

function createLayout(instances: PaneInstanceConfig[]): LayoutConfig {
  return {
    dockRoot: { kind: "pane", instanceId: instances[0]?.instanceId ?? "" },
    instances,
    floating: [],
    detached: [],
  };
}

function linkedLayout(): LayoutConfig {
  return createLayout([
    createPaneInstance("portfolio-list", {
      instanceId: "portfolio-list:main",
      binding: { kind: "none" },
    }),
    createPaneInstance("ticker-detail", {
      instanceId: "ticker-research:main",
      binding: { kind: "follow", sourceInstanceId: "portfolio-list:main" },
    }),
    createPaneInstance("ticker-news", {
      instanceId: "ticker-news:main",
      binding: { kind: "follow", sourceInstanceId: "portfolio-list:main" },
    }),
    createPaneInstance("chart-composer", {
      instanceId: "chart-composer:main",
      binding: { kind: "follow", sourceInstanceId: "ticker-research:main" },
    }),
    createPaneInstance("ticker-detail", {
      instanceId: "ticker-research:pinned",
      title: "NVDA",
      binding: { kind: "fixed", symbol: "NVDA" },
    }),
  ]);
}

describe("canRetargetPaneTicker", () => {
  test("covers research, news, and chart panes but not collections", () => {
    expect(canRetargetPaneTicker(createPaneInstance("ticker-detail"))).toBe(true);
    expect(canRetargetPaneTicker(createPaneInstance("ticker-news"))).toBe(true);
    expect(canRetargetPaneTicker(createPaneInstance("chart-composer"))).toBe(true);
    expect(canRetargetPaneTicker(createPaneInstance("tradingview"))).toBe(true);
    expect(canRetargetPaneTicker(createPaneInstance("portfolio-list"))).toBe(false);
    expect(canRetargetPaneTicker(createPaneInstance("chat"))).toBe(false);
  });
});

describe("resolveTickerWriteTarget", () => {
  test("writes follow chains through to the portfolio cursor", () => {
    const layout = linkedLayout();
    expect(resolveTickerWriteTarget(layout, "ticker-research:main")).toEqual({
      kind: "cursor",
      instanceId: "portfolio-list:main",
    });
    expect(resolveTickerWriteTarget(layout, "ticker-news:main")).toEqual({
      kind: "cursor",
      instanceId: "portfolio-list:main",
    });
    expect(resolveTickerWriteTarget(layout, "chart-composer:main")).toEqual({
      kind: "cursor",
      instanceId: "portfolio-list:main",
    });
  });

  test("writes a fixed pane onto itself", () => {
    expect(resolveTickerWriteTarget(linkedLayout(), "ticker-research:pinned")).toEqual({
      kind: "fixed",
      instanceId: "ticker-research:pinned",
    });
  });
});

describe("applyTickerRetarget", () => {
  test("changing a follow research pane updates the shared portfolio cursor", () => {
    const layout = linkedLayout();
    const result = applyTickerRetarget(layout, "ticker-research:main", "MSFT");
    expect(result.layout).toBe(layout);
    expect(result.cursor).toEqual({ paneId: "portfolio-list:main", symbol: "MSFT" });

    const config = createDefaultConfig("/tmp/gloomberb-ticker-follow");
    config.layout = layout;
    const state = createInitialState(config);
    state.paneState["portfolio-list:main"] = { collectionId: "main", cursorSymbol: "MSFT" };
    expect(resolveTickerForPane(state, "ticker-research:main")).toBe("MSFT");
    expect(resolveTickerForPane(state, "ticker-news:main")).toBe("MSFT");
    expect(resolveTickerForPane(state, "chart-composer:main")).toBe("MSFT");
    expect(resolveTickerForPane(state, "ticker-research:pinned")).toBe("NVDA");
  });

  test("changing a fixed pane does not retarget follow siblings", () => {
    const layout = linkedLayout();
    const result = applyTickerRetarget(layout, "ticker-research:pinned", "AAPL");
    expect(result.cursor).toBeNull();
    const pinned = result.layout.instances.find((instance) => instance.instanceId === "ticker-research:pinned");
    expect(pinned?.binding).toEqual({ kind: "fixed", symbol: "AAPL" });
    expect(pinned?.title).toBe("AAPL");
    expect(result.layout.instances.find((instance) => instance.instanceId === "ticker-research:main")?.binding)
      .toEqual({ kind: "follow", sourceInstanceId: "portfolio-list:main" });
  });

  test("changing a fixed source updates panes that follow it", () => {
    const layout = createLayout([
      createPaneInstance("ticker-detail", {
        instanceId: "ticker-research:source",
        title: "AAPL",
        binding: { kind: "fixed", symbol: "AAPL" },
      }),
      createPaneInstance("ticker-news", {
        instanceId: "ticker-news:follow",
        binding: { kind: "follow", sourceInstanceId: "ticker-research:source" },
      }),
    ]);
    const result = applyTickerRetarget(layout, "ticker-research:source", "MSFT");
    const config = createDefaultConfig("/tmp/gloomberb-ticker-follow-fixed");
    config.layout = result.layout;
    const state = createInitialState(config);
    expect(resolveTickerForPane(state, "ticker-research:source")).toBe("MSFT");
    expect(resolveTickerForPane(state, "ticker-news:follow")).toBe("MSFT");
  });
});

describe("setPaneFollowSource", () => {
  test("pins a follow pane to the current symbol", () => {
    const layout = setPaneFollowSource(linkedLayout(), "ticker-news:main", TICKER_FOLLOW_PINNED_VALUE, "AAPL");
    expect(layout.instances.find((instance) => instance.instanceId === "ticker-news:main")?.binding)
      .toEqual({ kind: "fixed", symbol: "AAPL" });
  });

  test("links a pinned pane onto research so both share the source ticker", () => {
    const layout = setPaneFollowSource(linkedLayout(), "ticker-research:pinned", "ticker-research:main", null);
    expect(currentFollowSourceValue(layout.instances.find((instance) => instance.instanceId === "ticker-research:pinned")!))
      .toBe("ticker-research:main");
  });

  test("rejects follow cycles", () => {
    const layout = linkedLayout();
    expect(wouldCreateFollowCycle(layout, "ticker-research:main", "chart-composer:main")).toBe(true);
    expect(setPaneFollowSource(layout, "ticker-research:main", "chart-composer:main", "AAPL")).toBe(layout);
  });
});
