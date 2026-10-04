import { describe, expect, test } from "bun:test";
import { footerErrorChip } from "../../../ui/status";
import { loadingErrorFooterInfo } from "../../../data-table/table-pane";
import {
  combinePaneFooterRegistrations,
  layoutPaneFooterHintRow,
  type PaneHint,
} from "./model";

const hints: PaneHint[] = [
  { id: "search", key: "/", label: "search" },
  { id: "open", key: "o", label: "pen" },
  { id: "pop-out", key: "p", label: "op out" },
  { id: "share", key: "s", label: "hare" },
  { id: "archive", key: "a", label: "rchive" },
  { id: "bookmark", key: "b", label: "ookmark" },
  { id: "copy", key: "c", label: "opy" },
  { id: "yank", key: "y", label: "ank" },
];

test("no-data yields no chip and a real error yields unavailable", () => {
  expect(footerErrorChip(null)).toBeNull();
  expect(footerErrorChip("")).toBeNull();
  expect(footerErrorChip("   ")).toBeNull();
  expect(footerErrorChip("No dividend data found for ZCSH")).toBeNull();
  expect(footerErrorChip("No analyst data for ZCSH")).toBeNull();
  expect(footerErrorChip("No options available.")).toBeNull();
  expect(footerErrorChip("NO_DATA")).toBeNull();
  expect(footerErrorChip("UPSTREAM_ERROR")).toEqual({ text: "unavailable", tone: "warning" });
  expect(footerErrorChip("The request timed out.")).toEqual({ text: "unavailable", tone: "warning" });

  expect(loadingErrorFooterInfo(false, "No options available.")).toEqual([
    { id: "error", parts: [{ text: "No options available.", tone: "warning" }] },
  ]);
  expect(loadingErrorFooterInfo(true, "No analyst data for ZCSH")).toEqual([
    { id: "loading", parts: [{ text: "loading", tone: "muted" }] },
    { id: "error", parts: [{ text: "No analyst data for ZCSH", tone: "warning" }] },
  ]);
  expect(loadingErrorFooterInfo(false, "No dividend data found")).toEqual([
    { id: "error", parts: [{ text: "No dividend data found", tone: "warning" }] },
  ]);
  expect(loadingErrorFooterInfo(true, "UPSTREAM_ERROR")).toEqual([
    { id: "loading", parts: [{ text: "loading", tone: "muted" }] },
    { id: "error", parts: [{ text: "UPSTREAM_ERROR", tone: "warning" }] },
  ]);
  expect(loadingErrorFooterInfo(false, "The request timed out.")).toEqual([
    { id: "error", parts: [{ text: "The request timed out.", tone: "warning" }] },
  ]);
  expect(loadingErrorFooterInfo(false, "provider down")).toEqual([
    { id: "error", parts: [{ text: "provider down", tone: "warning" }] },
  ]);
});

test("a refresh hint is absent from the prepared footer", () => {
  const footer = combinePaneFooterRegistrations(new Map([
    ["actions", {
      hints: [
        { id: "refresh", key: "r", label: "efresh", onPress() {} },
        { id: "retry", key: "r", label: "etry", onPress() {} },
        { id: "open", key: "o", label: "pen", onPress() {} },
      ],
    }],
  ]));
  expect(footer.hints.map((hint) => hint.id)).toEqual(["retry", "open"]);
  expect(footer.hints.some((hint) => hint.label.includes("efresh"))).toBe(false);
});

test("keeps a full status sentence in the prepared footer", () => {
  const sentence = "Save or cancel the edit first.";
  const prepared = combinePaneFooterRegistrations(new Map([
    ["status", { info: [{ id: "error", parts: [{ text: sentence, tone: "warning" as const }] }] }],
  ]));
  expect(prepared.info[0]?.parts[0]?.text).toBe(sentence);
});

describe("footer hint row", () => {
  const footer = {
    info: [{ id: "loading", parts: [{ text: "loading" }] }],
    hints: [
      { id: "refresh", key: "r", label: "efresh" },
      { id: "disabled", key: "x", label: "skip", disabled: true },
      ...hints,
    ],
    menu: [],
    keys: [],
  };

  test("puts hints that do not fit under More and keeps status space", () => {
    const row = layoutPaneFooterHintRow(footer, 32);
    expect(row.overflow.length).toBeGreaterThan(0);
    expect(row.moreLabel).toBe("More");
    expect([...row.hints, ...row.overflow].map((hint) => hint.id)).toEqual(hints.map((hint) => hint.id));
    expect(row.hintsWidth).toBeLessThanOrEqual(32);
    expect(row.infoWidth).toBeGreaterThanOrEqual("loading".length);
    expect(row.hintsWidth + row.infoWidth).toBeLessThanOrEqual(32);
  });

  test("keeps every hint on a wide row", () => {
    const row = layoutPaneFooterHintRow(footer, 120);
    expect(row.overflow).toEqual([]);
    expect(row.hints.map((hint) => hint.id)).toEqual(hints.map((hint) => hint.id));
  });
});
