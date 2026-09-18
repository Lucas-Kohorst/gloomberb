import { describe, expect, test } from "bun:test";
import { getPaneDisplayTitle } from "./title";
import { createDefaultConfig, type PaneInstanceConfig } from "../../../types/config";
import { createInitialState } from "../../../state/app/context";
import type { PaneDef } from "../../../types/plugin";

function instance(paneId: string, extras: Partial<PaneInstanceConfig> = {}): PaneInstanceConfig {
  return {
    instanceId: `${paneId}:test`,
    paneId,
    binding: { kind: "none" },
    ...extras,
  };
}

describe("getPaneDisplayTitle", () => {
  test("portfolio list keeps the pane name; collection tabs name the book", () => {
    const config = createDefaultConfig("/tmp/gloomberb-pane-title");
    const state = createInitialState(config);
    const paneDef = { id: "portfolio-list", name: "Portfolio", tickerSource: true } as PaneDef;

    expect(getPaneDisplayTitle(state, instance("portfolio-list", {
      params: { collectionId: "main" },
    }), paneDef)).toBe("Portfolio");
    expect(getPaneDisplayTitle(state, instance("portfolio-list", {
      params: { collectionId: "watchlist" },
    }), paneDef)).toBe("Portfolio");
  });
});
