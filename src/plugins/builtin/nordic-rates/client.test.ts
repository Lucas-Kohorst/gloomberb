import { describe, expect, test } from "bun:test";
import { parseBondYields, parseMortgageRates } from "./client";

/** Live mortgage-rates and average-yield payloads, each trimmed to two rows. */
const mortgageFixture = {
  data: {
    mortgageRates: {
      headers: {
        fullName: "Name",
        "3m": "3M",
        "1y": "1Y",
        "2y": "2Y",
        "3y": "3Y",
        "4y": "4Y",
        "5y": "5Y",
        "6y": "6Y",
        "7y": "7Y",
        "8y": "8Y",
        "9y": "9Y",
        "10y": "10Y",
      },
      rows: [
        {
          fullName: "Danske Bolån",
          "3m": "3.84",
          "1y": "3.49",
          "2y": "3.71",
          "3y": "3.84",
          "4y": "3.94",
          "5y": "3.99",
          "6y": "4.09",
          "7y": "---",
          "8y": "---",
          "9y": "---",
          "10y": "4.34",
          url: "https://danskebank.se/privat/produkter/bolan/",
        },
        {
          fullName: "Länsförsäkringar Bank",
          "3m": "3.94",
          "1y": "3.74",
          "2y": "3.99",
          "3y": "4.10",
          "4y": "4.19",
          "5y": "4.29",
          "6y": "---",
          "7y": "4.50",
          "8y": "---",
          "9y": "---",
          "10y": "4.60",
          url: "https://www.lansforsakringar.se/stockholm/privat/",
        },
      ],
    },
  },
  status: { rCode: 200 },
};

const yieldFixture = {
  data: {
    date: "2026-10-07",
    beforeTax: {
      headers: {
        attribute: "Rente før skat - restløbetid (år)",
        under3: "0-3",
        between3And5: "3-5",
        between5And15: "5-15",
        between15And25: "15-25",
        between25And35: "25-35",
        over35: "Over 35",
        total: "Total",
      },
      sections: [
        {
          name: "Stat, fiskeri & Færøerne",
          rows: [
            {
              attribute: "Effektiv rente",
              under3: "2.71",
              between3And5: "2.91",
              between5And15: "3.31",
              between15And25: "0.00",
              between25And35: "3.51",
              over35: "0.00",
              total: "3.15",
            },
            {
              attribute: "Antal papirer",
              under3: "2",
              between3And5: "1",
              between5And15: "3",
              between15And25: "0",
              between25And35: "1",
              over35: "0",
              total: "7",
            },
          ],
        },
        {
          name: "Enhedsprioritet",
          rows: [
            {
              attribute: "Effektiv rente",
              under3: "2.89",
              between3And5: "3.32",
              between5And15: "3.36",
              between15And25: "3.70",
              between25And35: "4.43",
              over35: "0.00",
              total: "3.56",
            },
            {
              attribute: "Antal papirer",
              under3: "44",
              between3And5: "24",
              between5And15: "53",
              between15And25: "56",
              between25And35: "89",
              over35: "0",
              total: "266",
            },
          ],
        },
      ],
    },
  },
  status: { rCode: 200 },
};

describe("nordic rates parsing", () => {
  test("reads quoted mortgage percents and skips unpublished terms", () => {
    const rates = parseMortgageRates(mortgageFixture);
    const danske = rates.filter((row) => row.lender === "Danske Bolån");
    const lans = rates.filter((row) => row.lender === "Länsförsäkringar Bank");
    expect(danske.map((row) => row.term)).toEqual(["3M", "1Y", "2Y", "3Y", "4Y", "5Y", "6Y", "10Y"]);
    expect(danske.map((row) => row.rate)).toEqual([3.84, 3.49, 3.71, 3.84, 3.94, 3.99, 4.09, 4.34]);
    expect(lans.map((row) => row.term)).toEqual(["3M", "1Y", "2Y", "3Y", "4Y", "5Y", "7Y", "10Y"]);
    expect(lans.find((row) => row.term === "10Y")?.rate).toBe(4.6);
    expect(rates.some((row) => row.term === "7Y" && row.lender === "Danske Bolån")).toBe(false);
  });

  test("reads before-tax effective yields and drops security counts", () => {
    const parsed = parseBondYields(yieldFixture);
    expect(parsed.asOf).toBe("2026-10-07");
    expect(parsed.yields.map((row) => [row.segment, row.maturity, row.yield])).toEqual([
      ["Government, fisheries & Faroe Islands", "0-3", 2.71],
      ["Government, fisheries & Faroe Islands", "3-5", 2.91],
      ["Government, fisheries & Faroe Islands", "5-15", 3.31],
      ["Government, fisheries & Faroe Islands", "15-25", 0],
      ["Government, fisheries & Faroe Islands", "25-35", 3.51],
      ["Government, fisheries & Faroe Islands", "Over 35", 0],
      ["Government, fisheries & Faroe Islands", "Total", 3.15],
      ["Unit priority mortgage", "0-3", 2.89],
      ["Unit priority mortgage", "3-5", 3.32],
      ["Unit priority mortgage", "5-15", 3.36],
      ["Unit priority mortgage", "15-25", 3.7],
      ["Unit priority mortgage", "25-35", 4.43],
      ["Unit priority mortgage", "Over 35", 0],
      ["Unit priority mortgage", "Total", 3.56],
    ]);
    expect(parsed.yields.some((row) => row.yield === 44 || row.yield === 266)).toBe(false);
  });

  test("rejects a failed envelope and a yield grid with no effective yield", () => {
    expect(() => parseMortgageRates({ status: { rCode: 500 }, data: {} })).toThrow(/rejected/);
    expect(() => parseBondYields({
      data: {
        date: "2026-10-07",
        beforeTax: {
          headers: { attribute: "Measure", under3: "0-3" },
          sections: [{ name: "Total", rows: [{ attribute: "Antal papirer", under3: "2" }] }],
        },
      },
    })).toThrow(/not recognized/);
  });
});
