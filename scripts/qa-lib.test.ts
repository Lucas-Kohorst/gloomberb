import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  checkCatalogEntries,
  checkCliEnvelope,
  checkPaneReport,
  checkTickerData,
  planFromFiles,
  siblingTestPath,
} from "./qa-lib";

describe("qa path mapping", () => {
  test("maps chart and valuation files onto panes and tests", () => {
    const root = mkdtempSync(join(tmpdir(), "gloom-qa-lib-"));
    mkdirSync(join(root, "src/plugins/builtin/chart-composer"), { recursive: true });
    writeFileSync(join(root, "src/plugins/catalog-ui.test.ts"), "");
    mkdirSync(join(root, "src/plugins/builtin/plugin-marketplace"), { recursive: true });
    writeFileSync(join(root, "src/plugins/builtin/plugin-marketplace/model.test.ts"), "");
    writeFileSync(join(root, "src/plugins/builtin/chart-composer/presets.test.ts"), "");
    mkdirSync(join(root, "src/plugins/builtin/market-valuation"), { recursive: true });
    writeFileSync(join(root, "src/plugins/builtin/market-valuation/model.test.ts"), "");

    const plan = planFromFiles(root, [
      "src/plugins/builtin/chart-composer/presets.ts",
      "src/plugins/builtin/market-valuation/pane.tsx",
      "src/time-series/spec.ts",
    ]);
    expect(plan.panes).toEqual(expect.arrayContaining(["chart-composer", "market-valuation", "plugin-marketplace"]));
    expect(plan.fn).toEqual(expect.arrayContaining(["graph-price-pane AAPL", "VAL"]));
    expect(plan.tests).toContain("src/plugins/catalog-ui.test.ts");
    expect(plan.tests).toContain("src/plugins/builtin/plugin-marketplace/model.test.ts");
  });

  test("siblingTestPath follows the repo convention", () => {
    expect(siblingTestPath("src/foo.ts")).toBe("src/foo.test.ts");
    expect(siblingTestPath("src/foo.tsx")).toBe("src/foo.test.tsx");
  });
});

describe("qa data invariants", () => {
  test("rejects a complete empty pane report", () => {
    expect(() => checkPaneReport({
      kind: "price-history",
      target: "AAPL",
      capabilityId: "price-chart",
      rowCount: 0,
      empty: true,
      complete: true,
      unavailableSymbols: [],
    })).toThrow(/zero rows/);
  });

  test("accepts a populated pane report", () => {
    checkPaneReport({
      kind: "price-history",
      target: "AAPL",
      capabilityId: "price-chart",
      rowCount: 12,
      empty: false,
      complete: true,
      unavailableSymbols: [],
    });
  });

  test("rejects empty+rowCount disagreement", () => {
    expect(() => checkPaneReport({
      kind: "price-history",
      target: "AAPL",
      capabilityId: "price-chart",
      rowCount: 3,
      empty: true,
      complete: true,
      unavailableSymbols: [],
    })).toThrow(/disagrees/);
  });

  test("requires a positive quote price", () => {
    expect(() => checkTickerData({
      symbol: "SPY",
      quote: { symbol: "SPY", price: 0, changePercent: 0 },
    })).toThrow(/price/);
    checkTickerData({
      symbol: "SPY",
      quote: { symbol: "SPY", price: 512.1, changePercent: -0.2 },
    });
  });

  test("unwraps the CLI ok envelope", () => {
    expect(checkCliEnvelope({ ok: true, data: { entries: [{ token: "VAL" }] } }).data)
      .toEqual({ entries: [{ token: "VAL" }] });
    expect(() => checkCliEnvelope({ ok: false })).toThrow(/ok:true/);
    checkCatalogEntries([{ token: "ECO", paneId: "econ-calendar" }]);
  });
});
