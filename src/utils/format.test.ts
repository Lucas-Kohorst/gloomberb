import { describe, expect, test } from "bun:test";
import {
  displayWidth,
  formatCompact,
  formatCurrency,
  formatGrowthShort,
  formatNumber,
  formatPercent,
  formatPercentRaw,
  formatTimeAgo,
  formatWithDivisor,
  padTo,
  truncateToDisplayWidth,
} from "./format";
import { normalizeTimestamp } from "./timestamp";

describe("formatTimeAgo", () => {
  test("handles UTC ISO timestamps with explicit offsets", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString().replace("Z", "+00:00");
    expect(formatTimeAgo(fiveMinutesAgo)).toBe("5m ago");
  });

  test("treats space-separated chat timestamps without a timezone as UTC", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString().replace("T", " ").replace("Z", "");
    expect(formatTimeAgo(fiveMinutesAgo)).toBe("5m ago");
  });
});

describe("normalizeTimestamp", () => {
  test("parses Twitter API timestamps", () => {
    expect(normalizeTimestamp("Wed Apr 29 03:20:20 +0000 2026")).toBe("2026-04-29T03:20:20.000Z");
  });
});

describe("padTo", () => {
  test("pads and truncates by display width instead of UTF-16 length", () => {
    expect(displayWidth("🇺🇸")).toBe(2);
    expect(padTo("🇺🇸", 2)).toBe("🇺🇸");
    expect(padTo("🇺🇸", 3)).toBe("🇺🇸 ");
    expect(padTo("🇺🇸", 1)).toBe(" ");
    expect(padTo("🇺🇸 CPI", 6)).toBe("🇺🇸 CPI");
  });
});

describe("truncateToDisplayWidth", () => {
  test("preserves grapheme clusters and stays within the terminal cell budget", () => {
    expect(displayWidth("📈")).toBe(2);
    expect(displayWidth("e\u0301")).toBe(1);
    expect(displayWidth("👨‍👩‍👧‍👦")).toBe(2);
    expect(truncateToDisplayWidth("投资组合分析面板", 9)).toBe("投资组...");
    expect(displayWidth(truncateToDisplayWidth("👨‍👩‍👧‍👦 family", 7))).toBeLessThanOrEqual(7);
  });
});

describe("non-finite values", () => {
  // A provider returning 0/0 for a ratio used to surface as "NaN%" in the UI,
  // indistinguishable from a real reading.
  test("numeric formatters render an em dash instead of NaN or Infinity", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatPercent(bad)).toBe("—");
      expect(formatPercentRaw(bad)).toBe("—");
      expect(formatCompact(bad)).toBe("—");
      expect(formatNumber(bad)).toBe("—");
      expect(formatCurrency(bad)).toBe("—");
      expect(formatGrowthShort(bad)).toBe("—");
      expect(formatWithDivisor(bad, 1000)).toBe("—");
    }
  });

  test("zero and negative values still format normally", () => {
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatNumber(0)).toBe("0.00");
    expect(formatPercent(-0.05)).toBe("-5.00%");
  });
});
