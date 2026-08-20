import { describe, expect, test } from "bun:test";
import { CREDIT_SERIES, type CreditConditionRow } from "./model";
import { moveCreditSelection } from "./index";

describe("moveCreditSelection", () => {
  test("steps through the visible credit rows", () => {
    const rows = CREDIT_SERIES.map((definition) => ({ seriesId: definition.seriesId })) as CreditConditionRow[];
    expect(moveCreditSelection(rows, CREDIT_SERIES[5].seriesId, -1)).toBe(CREDIT_SERIES[4].seriesId);
  });
});
