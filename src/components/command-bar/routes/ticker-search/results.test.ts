import { expect, test } from "bun:test";
import type { ResultItem } from "../../list/model";
import {
  mergePlainRootTickerResults,
  mergeTickerSearchResultItems,
  ROOT_SECURITY_ACTION_CHIPS,
} from "./results";

function resultItem(id: string, label: string, right: string, kind: ResultItem["kind"] = "ticker"): ResultItem {
  return {
    id,
    label,
    detail: "Apple Inc.",
    category: kind === "info" ? "Search" : "Saved",
    kind,
    right,
    action: () => {},
  };
}

test("keeps completed ticker-search results authoritative over provisional rows", () => {
  const authoritative = [
    resultItem("ranked:AAPL", "AAPL", "Equity NASDAQ"),
    resultItem("ranked:APC", "APC", "Equity XETRA"),
  ];
  const provisional = [
    resultItem("local:APC", "APC", "Equity XETRA"),
    resultItem("local:AAPL", "AAPL", "Equity NASDAQ"),
  ];

  expect(mergeTickerSearchResultItems("Apple", authoritative, provisional).map((item) => item.id)).toEqual([
    "ranked:AAPL",
    "ranked:APC",
  ]);

  const noResults = resultItem("no-results", "No matches for Apple", "", "info");
  expect(mergeTickerSearchResultItems("Apple", [noResults], [])).toEqual([noResults]);
});

test("plain root ticker results lead with the security and DES/QQ/G chips", () => {
  const exact = resultItem("ranked:AAPL", "AAPL", "Equity NASDAQ");
  exact.category = "Exact Match";
  const other = resultItem("ranked:APC", "APC", "Equity XETRA");
  const assist: ResultItem = {
    id: "assist:candidate:0:DES AAPL",
    label: "Open security details for AAPL",
    detail: "",
    category: "Ask AI",
    kind: "action",
    right: "DES  ✦",
    action: () => {},
  };

  const merged = mergePlainRootTickerResults("aapl", [exact, other], [assist]);
  expect(merged[0]?.label).toBe("AAPL  Apple Inc.  NASDAQ");
  expect(merged[0]?.right).toBe(ROOT_SECURITY_ACTION_CHIPS);
  expect(merged.map((item) => item.id)).toEqual([
    "ranked:AAPL",
    "assist:candidate:0:DES AAPL",
    "ranked:APC",
  ]);
  expect(merged.some((item) => item.label.includes("DES AAPL —"))).toBe(false);
});
