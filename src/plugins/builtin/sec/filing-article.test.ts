import { describe, expect, test } from "bun:test";
import type { SecFilingItem } from "../../../types/data-provider";
import { isPopOutEligibleFiling } from "./filing-article";

function filing(form: string): SecFilingItem {
  return { form } as SecFilingItem;
}

describe("isPopOutEligibleFiling", () => {
  test.each(["10-K", "10-Q", "10-K/A", "8-K", "8-K/A"])("opens %s in the article reader", (form) => {
    expect(isPopOutEligibleFiling(filing(form))).toBe(true);
  });

  test.each(["4", "3", "SC 13G", "DEF 14A", "S-1"])("keeps %s in the SEC pane", (form) => {
    expect(isPopOutEligibleFiling(filing(form))).toBe(false);
  });
});
