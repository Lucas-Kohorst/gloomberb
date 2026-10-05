import { expect, test } from "bun:test";
import { curveAsOf, treasurySpreadBp, type YieldPoint } from "./treasury-data";

function point(maturity: string, years: number, value: number | null, asOf?: string | null): YieldPoint {
  return { maturity, maturityYears: years, yield: value, asOf };
}

test("dates the curve from the newest observation present", () => {
  expect(curveAsOf([
    point("2Y", 2, 4.19, "2026-08-15"),
    point("10Y", 10, 4.72, "2026-08-17"),
    point("30Y", 30, 5.31, "2026-08-17"),
  ])).toBe("2026-08-17");
});

test("ignores points with no date rather than dropping the curve date", () => {
  expect(curveAsOf([
    point("2Y", 2, 4.19, null),
    point("10Y", 10, 4.72, "2026-08-17"),
  ])).toBe("2026-08-17");
});

test("reports no date when the server predates the field", () => {
  expect(curveAsOf([point("2Y", 2, 4.19), point("10Y", 10, 4.72)])).toBeNull();
});

test("reports the 10-year minus 2-year spread with its correct sign", () => {
  expect(treasurySpreadBp([point("2Y", 2, 4.19), point("10Y", 10, 4.72)])).toBe(53);
  expect(treasurySpreadBp([point("2Y", 2, 4.72), point("10Y", 10, 4.19)])).toBe(-53);
});

test("omits the 10-year minus 2-year spread when either yield is missing", () => {
  expect(treasurySpreadBp([point("2Y", 2, 4.19)])).toBeNull();
  expect(treasurySpreadBp([point("2Y", 2, null), point("10Y", 10, 4.72)])).toBeNull();
});
