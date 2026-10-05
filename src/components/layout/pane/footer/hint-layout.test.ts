import { describe, expect, test } from "bun:test";
import { layoutPaneFooterActions, measurePaneFooterHintRows, totalHintsWidth } from "./hint-layout";
import type { CombinedPaneFooter, PaneHint } from "./model";

const hints: PaneHint[] = [
  { id: "search", key: "/", label: "search" },
  { id: "open", key: "o", label: "pen" },
  { id: "pop-out", key: "p", label: "op out" },
  { id: "share", key: "s", label: "hare" },
  { id: "archive", key: "a", label: "rchive" },
  { id: "bookmark", key: "b", label: "ookmark" },
];
const footer: CombinedPaneFooter = {
  info: [{ id: "loading", parts: [{ text: "loading" }] }],
  trailingInfo: [{ id: "poll", parts: [{ text: "poll 1m" }] }],
  hints,
};

describe("footer action layout", () => {
  test("reserves status and polling space and keeps overflow reachable without exceeding two rows", () => {
    for (const width of [16, 24, 32, 42, 80]) {
      const layout = layoutPaneFooterActions(footer, width);
      const firstWidth = totalHintsWidth(layout.rows[0]!);
      const rightWidth = firstWidth + layout.trailingWidth + (firstWidth && layout.trailingWidth ? 1 : 0);
      expect(layout.infoWidth + rightWidth + (rightWidth ? 1 : 0)).toBeLessThanOrEqual(width);
      const second = layout.rows[1] ?? [];
      expect(totalHintsWidth(second) + (layout.overflow.length ? layout.moreWidth + (second.length ? 1 : 0) : 0))
        .toBeLessThanOrEqual(width);
      expect([...layout.rows.flat(), ...layout.overflow]).toEqual(hints);
      expect(layout.rows.length).toBeLessThanOrEqual(2);
    }
    expect(layoutPaneFooterActions(footer, 24).overflow.length).toBeGreaterThan(0);
    expect(layoutPaneFooterActions(footer, 80).overflow).toEqual([]);
  });

  test("measures Unicode actions in terminal cells, including the gap between actions", () => {
    expect(totalHintsWidth([
      { id: "one", key: "o", label: "中文" },
      { id: "two", key: "c", label: "e\u0301" },
    ])).toBe(12);
  });

  test("reserves the same height when inactive and leaves native wrapping to CSS", () => {
    expect(measurePaneFooterHintRows(footer, 24, { focused: true })).toBe(2);
    expect(measurePaneFooterHintRows(footer, 24, { focused: false })).toBe(2);
    expect(measurePaneFooterHintRows(footer, 24, { nativePaneChrome: true })).toBe(1);
    expect(measurePaneFooterHintRows(footer, 80)).toBe(1);
  });
});
