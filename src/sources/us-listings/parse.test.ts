import { describe, expect, test } from "bun:test";
import {
  mergeUsListings,
  parseNasdaqListedFile,
  parseOtherListedFile,
  parseSecCompanyTickersExchange,
  printToUniverse,
  universeToPrint,
} from "./parse";
import { searchUsListingsUniverse } from "./search";

const NASDAQ_FIXTURE = `Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
QQQ|Invesco QQQ Trust, Series 1|G|N|N|100|Y|N
ZZZZ|Fake Test Issue|Q|Y|N|100|N|N
File Creation Time: 0819202618:02
`;

const OTHER_FIXTURE = `ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
IBM|International Business Machines Corporation Common Stock|N|IBM|N|100|N|IBM
SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY
BRK.B|Berkshire Hathaway Inc. Class B|N|BRKB|N|100|N|BRK.B
`;

const SEC_FIXTURE = {
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [320193, "Apple Inc.", "AAPL", "Nasdaq"],
    [1045810, "NVIDIA CORP", "NVDA", "Nasdaq"],
    [123, "Pink Sheets Example Inc", "EXMPL", "OTC"],
  ],
};

describe("US listings parse", () => {
  test("keeps listed NYSE/Nasdaq/ARCA names and skips test issues", () => {
    const nasdaq = parseNasdaqListedFile(NASDAQ_FIXTURE);
    const other = parseOtherListedFile(OTHER_FIXTURE);
    expect(nasdaq.map((row) => row.symbol)).toEqual(["AAPL", "QQQ"]);
    expect(nasdaq[0]).toMatchObject({ exchange: "NASDAQ", type: "EQUITY", source: "nasdaqlisted" });
    expect(nasdaq[1]).toMatchObject({ type: "ETF" });
    expect(other.map((row) => [row.symbol, row.exchange, row.type])).toEqual([
      ["IBM", "NYSE", "EQUITY"],
      ["SPY", "ARCA", "ETF"],
      ["BRK.B", "NYSE", "EQUITY"],
    ]);
  });

  test("OTC from SEC only fills symbols missing from listed files", () => {
    const universe = mergeUsListings({
      nasdaqlisted: parseNasdaqListedFile(NASDAQ_FIXTURE),
      otherlisted: parseOtherListedFile(OTHER_FIXTURE),
      secOtc: parseSecCompanyTickersExchange(SEC_FIXTURE),
      asOf: "2026-08-20T00:00:00.000Z",
    });
    expect(universe.ttlSeconds).toBe(12 * 60 * 60);
    expect(universe.securities.find((row) => row.symbol === "AAPL")?.source).toBe("nasdaqlisted");
    expect(universe.securities.find((row) => row.symbol === "EXMPL")).toMatchObject({
      exchange: "OTC",
      source: "sec-otc",
    });
    expect(universe.securities.find((row) => row.symbol === "NVDA")).toBeUndefined();
  });

  test("round-trips the compact Adjacent Cloud print", () => {
    const universe = mergeUsListings({
      nasdaqlisted: parseNasdaqListedFile(NASDAQ_FIXTURE),
      otherlisted: [],
      secOtc: [],
      asOf: "2026-08-20T00:00:00.000Z",
    });
    expect(printToUniverse(universeToPrint(universe))?.securities).toEqual(universe.securities);
  });

  test("name search hits listed tickers Yahoo typeahead can miss", () => {
    const universe = mergeUsListings({
      nasdaqlisted: parseNasdaqListedFile(NASDAQ_FIXTURE),
      otherlisted: parseOtherListedFile(OTHER_FIXTURE),
      secOtc: [],
    });
    const hits = searchUsListingsUniverse(universe, "berkshire");
    expect(hits.map((hit) => hit.symbol)).toContain("BRK.B");
    expect(hits[0]?.providerId).toBe("us-listings");
  });
});
