import { describe, expect, test } from "bun:test";
import { measurePaneFooterHintRows, packFooterHintRows, totalHintsWidth } from "./hint-layout";
import type { CombinedPaneFooter, PaneHint } from "./model";

function hint(id: string, key: string, label: string): PaneHint {
  return { id, key, label };
}

describe("packFooterHintRows", () => {
  test("keeps a short hint row on one line", () => {
    const hints = [hint("refresh", "r", "efresh"), hint("open", "o", "pen")];
    expect(packFooterHintRows(hints, 40)).toEqual([hints]);
  });

  test("wraps extra hints onto a second row instead of clipping", () => {
    const hints = [
      hint("series", "s", "eries"),
      hint("window", "w", "indow"),
      hint("mode", "m", "ode"),
      hint("log", "l", "og"),
      hint("res", "r", "es"),
      hint("range", "1-8", "range"),
      hint("reload", "Shift+R", "reload"),
      hint("share", "y", "share"),
    ];
    const width = 42;
    expect(totalHintsWidth(hints)).toBeGreaterThan(width);
    const rows = packFooterHintRows(hints, width);
    expect(rows.length).toBe(2);
    expect(rows.flat().map((item) => item.id)).toEqual(hints.map((item) => item.id));
    expect(totalHintsWidth(rows[0]!)).toBeLessThanOrEqual(width);
  });
});

describe("measurePaneFooterHintRows", () => {
  test("native chrome stays one layout row because CSS wraps", () => {
    const footer: CombinedPaneFooter = {
      info: [],
      trailingInfo: [],
      hints: [hint("share", "y", "share"), hint("reload", "Shift+R", "reload")],
    };
    expect(measurePaneFooterHintRows(footer, 8, { focused: true, nativePaneChrome: true })).toBe(1);
  });

  test("keeps one reserved row when hints still fit", () => {
    const footer: CombinedPaneFooter = {
      info: [],
      trailingInfo: [],
      hints: [hint("refresh", "r", "efresh"), hint("open", "o", "pen")],
    };
    expect(measurePaneFooterHintRows(footer, 40, { focused: true })).toBe(1);
    expect(measurePaneFooterHintRows(footer, 40, { focused: false })).toBe(1);
  });

  test("reserves wrap rows even when unfocused so focusing does not shift body height", () => {
    const footer: CombinedPaneFooter = {
      info: [],
      trailingInfo: [],
      hints: [
        hint("series", "s", "eries"),
        hint("window", "w", "indow"),
        hint("mode", "m", "ode"),
        hint("log", "l", "og"),
        hint("res", "r", "es"),
        hint("range", "1-8", "range"),
        hint("reload", "Shift+R", "reload"),
        hint("share", "y", "share"),
      ],
    };
    const focusedRows = measurePaneFooterHintRows(footer, 42, { focused: true });
    const unfocusedRows = measurePaneFooterHintRows(footer, 42, { focused: false });
    expect(focusedRows).toBe(2);
    expect(unfocusedRows).toBe(focusedRows);
  });
});
