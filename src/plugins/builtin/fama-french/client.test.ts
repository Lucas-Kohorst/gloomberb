import { describe, expect, test } from "bun:test";
import { parseFactorCsv } from "./client";

const SNIPPET = [
  "This file was created using the 202608 CRSP database.",
  "The 1-month TBill rate data until 202405 are from Ibbotson Associates.",
  "",
  ",Mkt-RF,SMB,HML,RF",
  "202607,  -0.61,  -1.92,   2.11,   0.33",
  "202608,   2.56,   0.34,  -3.54,   0.29",
  "",
  " Annual Factors: January-December ",
  ",Mkt-RF,SMB,HML,RF",
  "  2025,  13.30, -10.79,   8.71,   4.25",
  "  2026,  99.99,  99.99,  99.99,  99.99",
].join("\r\n");

describe("parseFactorCsv", () => {
  test("keeps monthly rows newest first and drops the annual section", () => {
    const parsed = parseFactorCsv(SNIPPET);
    expect(parsed.vintage).toBe("This file was created using the 202608 CRSP database.");
    expect(parsed.months).toEqual([
      { month: "202608", marketMinusRf: 2.56, size: 0.34, value: -3.54, rf: 0.29 },
      { month: "202607", marketMinusRf: -0.61, size: -1.92, value: 2.11, rf: 0.33 },
    ]);
  });

  test("keeps the latest 36 months when the monthly table is longer", () => {
    const monthly = Array.from({ length: 40 }, (_, index) => {
      const year = 2000 + Math.floor(index / 12);
      const month = String((index % 12) + 1).padStart(2, "0");
      return `${year}${month}, ${index}, ${index + 1}, ${index + 2}, 0.10`;
    });
    const parsed = parseFactorCsv([
      "Notes. This file was created using the 202401 CRSP database. More notes.",
      ",Mkt-RF,SMB,HML,RF",
      ...monthly,
      "",
      " Annual Factors: January-December ",
      ",Mkt-RF,SMB,HML,RF",
      "  1999,  999,  999,  999,  999",
    ].join("\n"));
    expect(parsed.vintage).toBe("This file was created using the 202401 CRSP database.");
    expect(parsed.months).toHaveLength(36);
    expect(parsed.months[0]).toMatchObject({ month: "200304", marketMinusRf: 39, size: 40, value: 41, rf: 0.1 });
    expect(parsed.months[35]?.month).toBe("200005");
    expect(parsed.months.some((row) => row.marketMinusRf === 999)).toBe(false);
  });
});
