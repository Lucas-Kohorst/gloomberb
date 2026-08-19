import { describe, expect, test } from "bun:test";
import {
  cliProductCodeForIcao,
  detectCliPrintKind,
  firstFinalCliPrint,
  normalizeIcaoStation,
  parseClimateSummaryDate,
  parseNwsCliProductText,
} from "./parse";
import type { NwsCliPrint } from "./types";

const CLINYC = `000
CDUS41 KOKX 190532
CLINYC

CLIMATE REPORT
NATIONAL WEATHER SERVICE NEW YORK NY
132 AM EDT WED AUG 19 2026

...THE CENTRAL PARK NY CLIMATE SUMMARY FOR AUGUST 18 2026...

CLIMATE NORMAL PERIOD 1991 TO 2020
CLIMATE RECORD PERIOD 1869 TO 2026

WEATHER ITEM   OBSERVED TIME   RECORD YEAR NORMAL DEPARTURE LAST
                VALUE   (LST)  VALUE       VALUE  FROM      YEAR
                                                  NORMAL
TEMPERATURE (F)
 YESTERDAY
  MAXIMUM         87    259 PM  97    2002  84      3       82
  MINIMUM         70    530 AM  59    1964  69      1       67
  AVERAGE         79                        76      3       75

PRECIPITATION (IN)
  YESTERDAY        0.12          2.35 2009   0.15  -0.03     0.00
  MONTH TO DATE    1.10
`;

const PRELIM = CLINYC.replace(
  "CLIMATE REPORT",
  "PRELIMINARY LOCAL CLIMATE DATA",
).replace("MAXIMUM         87", "MAXIMUM         84");

function print(overrides: Partial<NwsCliPrint> = {}): NwsCliPrint {
  return {
    provider: "nws-cli",
    seriesId: "KNYC",
    icao: "KNYC",
    cliProduct: "CLINYC",
    date: "2026-08-18",
    issuedAt: "2026-08-19T05:32:00Z",
    printKind: "final",
    highF: 87,
    lowF: 70,
    precipIn: 0.12,
    productId: "abc",
    sourceUrl: "https://api.weather.gov/products/abc",
    ...overrides,
  };
}

describe("NWS CLI parse", () => {
  test("normalizes ICAO and CLI product codes without using market tickers", () => {
    expect(normalizeIcaoStation("knyc")).toBe("KNYC");
    expect(normalizeIcaoStation("NYC")).toBe("KNYC");
    expect(normalizeIcaoStation("CLINYC")).toBe("KNYC");
    expect(cliProductCodeForIcao("KNYC")).toBe("CLINYC");
  });

  test("parses first-final daily climate high/low/precip from CLI text", () => {
    expect(parseClimateSummaryDate(CLINYC)).toBe("2026-08-18");
    expect(detectCliPrintKind(CLINYC)).toBe("final");
    expect(detectCliPrintKind(PRELIM)).toBe("preliminary");
    const parsed = parseNwsCliProductText(CLINYC, { icao: "KNYC", issuedAt: "2026-08-19T05:32:00Z" });
    expect(parsed).toMatchObject({
      provider: "nws-cli",
      seriesId: "KNYC",
      icao: "KNYC",
      cliProduct: "CLINYC",
      date: "2026-08-18",
      printKind: "final",
      highF: 87,
      lowF: 70,
      precipIn: 0.12,
    });
  });

  test("firstFinalCliPrint prefers the earliest final print for a date", () => {
    const chosen = firstFinalCliPrint([
      print({ printKind: "preliminary", issuedAt: "2026-08-18T18:00:00Z", highF: 84 }),
      print({ issuedAt: "2026-08-19T09:00:00Z", highF: 88, productId: "later" }),
      print({ issuedAt: "2026-08-19T05:32:00Z", highF: 87, productId: "first" }),
    ], "2026-08-18");
    expect(chosen?.productId).toBe("first");
    expect(chosen?.highF).toBe(87);
  });
});
