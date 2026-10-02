import { describe, expect, test } from "bun:test";
import {
  combinePaneFooterRegistrations,
  isBindableFooterHintKey,
  selectPaneFooterHints,
  type PaneFooterRegistration,
  type PaneFooterSegment,
} from "./model";

describe("pane footer hint keys", () => {
  test("rejects one-glyph aliases for keys the footer binder cannot press", () => {
    expect(isBindableFooterHintKey("e")).toBe(true);
    expect(isBindableFooterHintKey("/")).toBe(true);
    expect(isBindableFooterHintKey("↵")).toBe(false);
    expect(isBindableFooterHintKey("←")).toBe(false);
    expect(isBindableFooterHintKey(" ")).toBe(false);
    expect(isBindableFooterHintKey("1")).toBe(false);
    expect(isBindableFooterHintKey("8")).toBe(false);
  });
});

function segment(id: string, text: string): PaneFooterSegment {
  return { id, parts: [{ text }] };
}

describe("pane footer left chrome", () => {
  test("combines changing status and source context without row counts", () => {
    const registrations = new Map<string, PaneFooterRegistration>([
      ["feed", {
        info: [
          segment("live", "live"),
          segment("count", "25 rows"),
          segment("updated", "updated ~0m"),
        ],
      }],
      ["link", {
        info: [segment("external-link", "source European Central Bank")],
        hints: [{ id: "open", key: "o", label: "pen" }],
      }],
      ["agent", {
        info: [segment("running", "Streaming reply")],
      }],
    ]);
    const footer = combinePaneFooterRegistrations(registrations);
    expect(footer.info.map((entry) => entry.id)).toEqual(["running", "live", "updated", "external-link"]);
    expect(footer.hints).toHaveLength(1);
  });

  test("selects enabled hints for requested registrations", () => {
    const registrations = new Map<string, PaneFooterRegistration>([
      ["table", { order: 2, hints: [{ id: "search", key: "s", label: "earch" }] }],
      ["detail", {
        order: 1,
        hints: [
          { id: "open", key: "o", label: "pen" },
          { id: "disabled", key: "x", label: "Unavailable", disabled: true },
        ],
      }],
    ]);

    expect(selectPaneFooterHints(registrations, ["table"]).map((hint) => hint.id)).toEqual(["search"]);
    expect(selectPaneFooterHints(registrations, ["missing"])).toEqual([]);
    expect(selectPaneFooterHints(registrations).map((hint) => hint.id)).toEqual(["open", "search"]);
  });
});
