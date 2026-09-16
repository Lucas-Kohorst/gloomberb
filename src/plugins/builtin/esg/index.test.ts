import { describe, expect, test } from "bun:test";
import { esgModule } from "./index";

describe("esgModule", () => {
  test("registers ESG as a Ticker Research tab", () => {
    expect(esgModule.panes ?? []).toHaveLength(0);
  });

  test("registers a pane template with the ESG shortcut prefix", () => {
    const template = esgModule.paneTemplates?.[0];
    expect(template?.id).toBe("esg-pane");
    expect(template?.paneId).toBe("ticker-research");
    expect(template?.shortcut?.prefix).toBe("ESG");
    expect(template?.shortcut?.argKind).toBe("ticker");
    expect(template?.shortcut?.argPlaceholder).toBe("ticker");
  });

  test("createInstance returns a floating pane bound to the ticker", () => {
    const template = esgModule.paneTemplates?.[0];
    const instance = template?.createInstance?.(
      { activeTicker: "AAPL" } as never,
      { symbol: "AAPL" },
    );
    expect(instance).not.toBeNull();
    expect(instance?.title).toBe("ESG AAPL");
    expect(instance?.binding).toEqual({ kind: "fixed", symbol: "AAPL" });
    expect(instance?.placement).toBe("floating");
  });

  test("canCreate returns true when a symbol is resolvable", () => {
    const template = esgModule.paneTemplates?.[0];
    expect(template?.canCreate?.({ activeTicker: "AAPL" } as never, { symbol: "AAPL" })).toBe(true);
    expect(template?.canCreate?.({ activeTicker: null } as never, undefined)).toBe(false);
  });

  test("description mentions ESG and climate keywords", () => {
    const template = esgModule.paneTemplates?.[0];
    expect(template?.description).toMatch(/ESG/i);
    expect(template?.description).toMatch(/climate/i);
  });
});
