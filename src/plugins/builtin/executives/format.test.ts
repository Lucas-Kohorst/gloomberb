import { describe, expect, test } from "bun:test";
import type { CloudExecutiveRowPayload } from "../../../api-client";
import {
  equityShare,
  formatChange,
  formatFiled,
  formatPay,
  formatRatio,
  shortTitle,
} from "./format";

const row = (overrides: Partial<CloudExecutiveRowPayload> = {}): CloudExecutiveRowPayload => ({
  name: "Jane Doe",
  title: "Chief Executive Officer",
  salary: 1_000_000,
  bonus: 0,
  stockAwards: 8_000_000,
  optionAwards: 1_000_000,
  nonEquityIncentive: 0,
  pensionAndDeferred: 0,
  allOther: 0,
  total: 10_000_000,
  ...overrides,
});

describe("executive pay formatters", () => {
  test("formats dollars by magnitude without a trailing .0", () => {
    expect(formatPay(null)).toBe("—");
    expect(formatPay(50_000)).toBe("$50,000");
    expect(formatPay(282_000)).toBe("$282K");
    expect(formatPay(36_300_000)).toBe("$36.3M");
    expect(formatPay(1_000_000)).toBe("$1M");
    expect(formatPay(2_500_000_000)).toBe("$2.5B");
  });

  test("formats pay ratio and year-over-year change", () => {
    expect(formatRatio(272)).toBe("272:1");
    expect(formatRatio(null)).toBe("—");
    expect(formatChange(117, 100)).toBe("+17%");
    expect(formatChange(73, 100)).toBe("-27%");
    expect(formatChange(100, null)).toBe("");
    expect(formatChange(0, 100)).toBe("-100%");
  });

  test("keeps equity share as a percent of total and shortens titles", () => {
    expect(equityShare(row())).toBe("90%");
    expect(equityShare(row({ total: 0 }))).toBe("");
    expect(equityShare(row({ stockAwards: 0, optionAwards: 0 }))).toBe("");
    expect(shortTitle("President and Chief Executive Officer", 18)).toBe("President and Chi…");
    expect(shortTitle("CEO", 18)).toBe("CEO");
  });

  test("formats filing dates and blanks invalid ones", () => {
    expect(formatFiled("2026-04-15T00:00:00.000Z")).toMatch(/Apr 1[45], 2026/);
    expect(formatFiled(null)).toBe("—");
    expect(formatFiled("not-a-date")).toBe("—");
  });

  test("compensation comparisons preserve fractional changes and reported zero", () => {
    // Captured AAPL 2026 proxy, fiscal 2025 versus fiscal 2024.
    expect(formatChange(74_294_811, 74_609_802)).toBe("-0.42%");
    expect(formatChange(100.42, 100)).toBe("+0.42%");
    expect(formatChange(0, 100)).toBe("-100%");
    expect(formatChange(100, 100)).toBe("0%");
    expect(formatChange(100.001, 100)).toBe("+<0.01%");
    expect(formatChange(99.999, 100)).toBe("-<0.01%");
  });

  test("compensation comparisons require finite amounts and a positive prior year", () => {
    for (const missing of [null, undefined, Number.NaN, Infinity, -Infinity]) {
      expect(formatChange(missing, 100)).toBe("");
      expect(formatChange(100, missing)).toBe("");
    }
    expect(formatChange(0, 0)).toBe("");
    expect(formatChange(100, 0)).toBe("");
    expect(formatChange(100, -1)).toBe("");
    expect(formatChange(Number.MAX_VALUE, Number.MIN_VALUE)).toBe("");
  });
});
