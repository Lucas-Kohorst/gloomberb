import { describe, expect, test } from "bun:test";
import { isValidIsin, normalizeIsin } from "./isin";

describe("ISIN validation", () => {
  test("accepts well-known valid ISINs with correct check digits", () => {
    expect(isValidIsin("US0378331005")).toBe(true);   // Apple
    expect(isValidIsin("US5949181045")).toBe(true);   // Microsoft
    expect(isValidIsin("DE0005140008")).toBe(true);   // Deutsche Bank
    expect(isValidIsin("LU1681047236")).toBe(true);   // Amundi MSCI World ETF
  });

  test("accepts lower-case input by normalizing before validation", () => {
    expect(isValidIsin("us0378331005")).toBe(true);
    expect(isValidIsin("  US0378331005  ")).toBe(true);
  });

  test("rejects a bad check digit", () => {
    expect(isValidIsin("US0378331004")).toBe(false);
    expect(isValidIsin("LU1681047237")).toBe(false);
  });

  test("rejects wrong length", () => {
    expect(isValidIsin("US037833100")).toBe(false);   // 11 chars
    expect(isValidIsin("US03783310055")).toBe(false);  // 13 chars
  });

  test("rejects non-ISIN ticker symbols and plain text", () => {
    expect(isValidIsin("AAPL")).toBe(false);
    expect(isValidIsin("BRK.B")).toBe(false);
    expect(isValidIsin("")).toBe(false);
    expect(isValidIsin("HELLO WORLD")).toBe(false);
  });

  test("normalizeIsin trims, upper-cases, and handles non-strings", () => {
    expect(normalizeIsin("  lu1681047236  ")).toBe("LU1681047236");
    expect(normalizeIsin(undefined)).toBe("");
    expect(normalizeIsin(42)).toBe("");
  });
});
