import { describe, expect, test } from "bun:test";
import { parseSeriesObservations } from "./client";
import { selectSeries, toDealerRow, SERIES_CAP, type CatalogEntry } from "./model";

const ONE_SERIES = {
  pd: {
    timeseries: [
      { asofdate: "2026-09-30", keyid: "PDPOSGST-TOT", value: "432032", unit: "USD millions" },
      { asofdate: "2026-09-23", keyid: "PDPOSGST-TOT", value: "470836" },
    ],
  },
};

describe("primary dealer series", () => {
  test("parses one series with two points into the latest observation, the one before it, and the change", () => {
    const parsed = parseSeriesObservations(ONE_SERIES);
    expect(parsed).toEqual({
      keyid: "PDPOSGST-TOT",
      unit: "USD millions",
      latest: { asOf: "2026-09-30", value: 432032 },
      previous: { asOf: "2026-09-23", value: 470836 },
    });
    const row = toDealerRow(
      { seriesBreak: "SBN2024", keyid: "PDPOSGST-TOT", description: "Total - U.S. TREASURY SECURITIES (EXCLUDING TIPS)" },
      parsed,
      "positions",
    );
    expect(row.label).toBe("Treasuries ex-TIPS");
    expect(row.change).toBe(432032 - 470836);
    expect(row.unit).toBe("USD millions");
  });

  test("keeps the newest break's treasury and mortgage-backed totals, within the series cap", () => {
    const extras: CatalogEntry[] = Array.from({ length: 20 }, (_, index) => ({
      seriesBreak: "SBN2024",
      keyid: `PDFAIL-X${index}`,
      description: "Total - U.S. TREASURY fails",
    }));
    const selected = selectSeries([
      { seriesBreak: "SBN2022", keyid: "PDPOSGST-TOT", description: "Total - U.S. TREASURY SECURITIES" },
      { seriesBreak: "SBN2024", keyid: "PDPOSCS-TOT", description: "Total - CORPORATE SECURITIES" },
      { seriesBreak: "SBN2024", keyid: "PDPOSGSC-L2", description: "U.S. TREASURY COUPONS DUE IN LESS THAN OR EQUAL TO 2 YEARS" },
      { seriesBreak: "SBN2024", keyid: "PDPOSGST-TOTC", description: "Total - U.S. TREASURY SECURITIES - Change From Previous Week" },
      { seriesBreak: "SBN2024", keyid: "PDPOSMBS-TOT", description: "Total - Mortgage-backed Securities: Federal Agency and GSE MBS" },
      { seriesBreak: "SBN2024", keyid: "PDPOSGST-TOT", description: "Total - U.S. TREASURY SECURITIES (EXCLUDING TIPS)" },
      { seriesBreak: "SBN2024", keyid: "PDFTD-CS", description: "CORPORATE SECURITIES : DEALER FINANCING FAILS TO DELIVER" },
      { seriesBreak: "SBN2024", keyid: "PDFTD-USTET", description: "U.S. TREASURY SECURITIES : DEALER FINANCING FAILS TO DELIVER" },
      { seriesBreak: "SBN2024", keyid: "PDFTD-FGEM", description: "FEDERAL AGENCY AND GSE SECURITIES (EXCLUDING MBS) : DEALER FINANCING FAILS TO DELIVER" },
      ...extras,
    ]);
    expect(selected.seriesBreak).toBe("SBN2024");
    expect(selected.positions.map((entry) => entry.keyid)).toEqual(["PDPOSGST-TOT", "PDPOSMBS-TOT"]);
    expect(selected.fails.map((entry) => entry.keyid)).toContain("PDFTD-USTET");
    expect(selected.fails.map((entry) => entry.keyid)).not.toContain("PDFTD-CS");
    expect(selected.fails.map((entry) => entry.keyid)).not.toContain("PDFTD-FGEM");
    expect(selected.positions.length + selected.fails.length).toBeLessThanOrEqual(SERIES_CAP);
    expect(selected.positions.length + selected.fails.length).toBe(SERIES_CAP);
  });
});
