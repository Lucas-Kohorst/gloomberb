import { describe, expect, test } from "bun:test";
import { buildListRows, shouldOmitAskAiHeading, type ListScreenState, type ResultItem } from "./model";

function item(partial: Partial<ResultItem> & Pick<ResultItem, "id" | "label" | "category" | "kind">): ResultItem {
  return {
    detail: "",
    action: () => {},
    ...partial,
  };
}

describe("shouldOmitAskAiHeading", () => {
  test("drops a single Ask AI heading when a ticker already matched", () => {
    const sections = [
      { category: "Exact Match", items: [item({ id: "aapl", label: "AAPL  Apple Inc.", category: "Exact Match", kind: "ticker" })] },
      { category: "Ask AI", items: [item({ id: "assist", label: "Ask AI — sign up to enable", category: "Ask AI", kind: "action" })] },
    ];
    expect(shouldOmitAskAiHeading(sections[1]!, sections)).toBe(true);
    expect(shouldOmitAskAiHeading(sections[0]!, sections)).toBe(false);
  });
});

describe("buildListRows", () => {
  test("keeps a rule before Ask AI without repeating the heading on a ticker hit", () => {
    const listState: ListScreenState = {
      kind: "root",
      title: "Command",
      query: "aapl",
      selectedIdx: 0,
      hoveredIdx: null,
      results: [
        item({ id: "aapl", label: "AAPL  Apple Inc.", category: "Exact Match", kind: "ticker", right: "DES QQ G" }),
        item({ id: "assist", label: "Ask AI — sign up to enable", category: "Ask AI", kind: "action" }),
      ],
      searching: false,
      emptyLabel: "",
      emptyDetail: "",
      footerLeft: "",
      footerRight: "",
    };
    const rows = buildListRows(listState);
    expect(rows.map((row) => row.kind)).toEqual(["heading", "item", "spacer", "item"]);
    expect(rows.some((row) => row.kind === "heading" && row.label === "Ask AI")).toBe(false);
  });
});
