import { describe, expect, test } from "bun:test";
import { parseBulkImport, resolveBulkImportEntries } from "./import";

describe("bulk ticker import parsing", () => {
  test("parses comma, whitespace, and newline separated watchlist symbols", () => {
    expect(parseBulkImport("aapl, MSFT\n nvda   amd", "watchlist")).toEqual({
      entries: [
        { line: 1, symbol: "AAPL" },
        { line: 1, symbol: "MSFT" },
        { line: 2, symbol: "NVDA" },
        { line: 2, symbol: "AMD" },
      ],
      failures: [],
      hasPositions: false,
    });
  });

  test("detects portfolio CSV position rows", () => {
    expect(parseBulkImport("AAPL, 10, 180.50\nMSFT", "portfolio")).toEqual({
      entries: [
        { line: 1, symbol: "AAPL", shares: 10, avgCost: 180.5 },
        { line: 2, symbol: "MSFT" },
      ],
      failures: [],
      hasPositions: true,
    });
  });

  test("reports malformed CSV rows and watchlist positions", () => {
    expect(parseBulkImport("AAPL, 10\nMSFT, 2, 400", "portfolio").failures).toEqual([
      { line: 1, symbol: "AAPL", reason: "CSV rows require symbol, shares, and average cost" },
    ]);
    expect(parseBulkImport("MSFT, 2, 400", "watchlist").failures).toEqual([
      { line: 1, symbol: "MSFT", reason: "Positions can only be imported into portfolios" },
    ]);
  });
});

describe("bulk ticker resolution", () => {
  test("keeps failures alongside resolved entries and rejects duplicate symbols", async () => {
    const entries = parseBulkImport("AAPL BAD AAPL", "watchlist").entries;
    const results = await resolveBulkImportEntries(entries, async (entry) => (
      entry.symbol === "BAD" ? { reason: "No exact ticker match" } : { value: entry.symbol }
    ));
    expect(results.map((result) => result.failure?.reason ?? result.value)).toEqual([
      "AAPL",
      "No exact ticker match",
      "Duplicate symbol in import",
    ]);
  });
});
