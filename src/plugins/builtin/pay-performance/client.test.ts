import { describe, expect, test } from "bun:test";
import { cikForTicker, extractPayFactDocument, parsePayFacts } from "./client";

const fixture = {
  cik: 1,
  entityName: "Example Co",
  facts: {
    "us-gaap": {
      Revenues: {
        label: "Revenues",
        description: "The total shareholder return and compensation actually paid are discussed here.",
        units: {
          USD: [{ end: "2024-12-31", val: 999, fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01" }],
        },
      },
    },
    ecd: {
      PeoActuallyPaidCompAmt: {
        label: "PEO Actually Paid Compensation Amount",
        units: {
          USD: [
            { end: "2023-12-31", val: 1_000_000, fy: null, fp: null, form: "DEF 14A", filed: "2025-04-01", frame: "CY2023" },
            { end: "2024-12-31", val: 2_000_000, fy: null, fp: null, form: "DEF 14A", filed: "2025-04-01", frame: "CY2024" },
            { end: "2024-12-31", val: 1_500_000, fy: null, fp: null, form: "DEF 14A", filed: "2024-04-01", frame: "CY2024" },
          ],
        },
      },
      NonPeoNeoAvgCompActuallyPaidAmt: {
        label: "Non-PEO NEO Average Compensation Actually Paid Amount",
        units: {
          USD: [{ end: "2024-12-31", val: 50, fy: null, filed: "2025-04-01", frame: "CY2024" }],
        },
      },
      TotalShareholderRtnAmt: {
        label: "Total Shareholder Return Amount",
        units: {
          USD: [
            { start: "2024-01-01", end: "2024-03-31", val: 1, fy: null, fp: "Q1", filed: "2025-04-01", frame: "CY2024Q1" },
            { end: "2023-12-31", val: 110.5, fy: null, filed: "2025-04-01", frame: "CY2023" },
            { end: "2024-12-31", val: 125.25, fy: null, filed: "2025-04-01", frame: "CY2024" },
          ],
        },
      },
      PeerGroupTotalShareholderRtnAmt: {
        label: "Peer Group Total Shareholder Return Amount",
        units: {
          USD: [{ end: "2024-12-31", val: 118, fy: null, filed: "2025-04-01", frame: "CY2024" }],
        },
      },
      CustomCap: {
        label: "Compensation actually paid to the executive",
        units: {
          USD: [{ end: "2022-12-31", val: 10, filed: "2025-04-01" }],
        },
      },
    },
  },
};

describe("parsePayFacts", () => {
  test("builds a year from compensation actually paid and company and peer return", () => {
    expect(parsePayFacts(fixture)).toEqual([
      { year: 2024, compensationActuallyPaid: 2_000_000, companyReturn: 125.25, peerReturn: 118 },
      { year: 2023, compensationActuallyPaid: 1_000_000, companyReturn: 110.5, peerReturn: null },
      { year: 2022, compensationActuallyPaid: 10, companyReturn: null, peerReturn: null },
    ]);
  });

  test("uses the fiscal year, then the period end, not the calendar frame", () => {
    const rows = parsePayFacts({
      facts: {
        ecd: {
          TotalShareholderRtnAmt: {
            label: "Total Shareholder Return Amount",
            units: {
              USD: [
                { fy: 2024, end: "2025-01-31", val: 10, filed: "2025-03-01", frame: "CY2025" },
                { fy: null, end: "2026-05-31", val: 11, filed: "2026-08-01", frame: "CY2025" },
              ],
            },
          },
        },
      },
    });
    expect(rows.map((row) => [row.year, row.companyReturn])).toEqual([[2026, 11], [2024, 10]]);
  });

  test("rejects a document with none of the pay versus performance tags", () => {
    expect(() => parsePayFacts({
      facts: {
        "us-gaap": {
          Revenues: {
            label: "Revenues",
            description: "The total shareholder return and compensation actually paid are discussed here.",
            units: { USD: [{ fy: 2024, end: "2024-12-31", val: 5, filed: "2025-02-01", fp: "FY" }] },
          },
        },
      },
    })).toThrow("No pay versus performance facts for this ticker.");
  });

  test("keeps a pay tag that has no yearly amounts", () => {
    expect(parsePayFacts({
      facts: {
        ecd: {
          PvpTableTextBlock: {
            label: "Pay vs Performance Disclosure",
            units: { pure: [{ val: "narrative", filed: "2025-01-01" }] },
          },
        },
      },
    })).toEqual([]);
  });

  test("reads only matched concepts out of a companyfacts document", () => {
    const text = JSON.stringify({
      cik: 1,
      entityName: "Example",
      facts: {
        "us-gaap": {
          Revenues: {
            label: "Revenues",
            description: "mentions compensation actually paid and a brace } plus \"quotes\"",
            units: { USD: [{ end: "2024-12-31", val: 999, fy: 2024, fp: "FY", filed: "2025-02-01" }] },
          },
        },
        ecd: {
          PeoActuallyPaidCompAmt: {
            label: "",
            description: "",
            units: { USD: [{ end: "2026-05-31", val: 42, filed: "2026-08-04", fy: null, frame: "CY2025" }] },
          },
          TotalShareholderRtnAmt: {
            label: "Total Shareholder Return Amount",
            units: { USD: [{ end: "2026-05-31", val: 130.5, filed: "2026-08-04", fy: null, frame: "CY2025" }] },
          },
        },
      },
    }, null, 2);
    const reduced = extractPayFactDocument(text);
    expect(Object.keys(reduced.facts)).toEqual(["ecd"]);
    expect(parsePayFacts(reduced)).toEqual([
      { year: 2026, compensationActuallyPaid: 42, companyReturn: 130.5, peerReturn: null },
    ]);
  });

  test("pads the company identifier from the ticker list", () => {
    const payload = { "0": { cik_str: 1750, ticker: "AIR", title: "AAR CORP" } };
    expect(cikForTicker(payload, "air")).toBe("0000001750");
    expect(cikForTicker(payload, "BRK.B")).toBeNull();
    expect(cikForTicker({ "0": { cik_str: 1067983, ticker: "BRK-B", title: "BERKSHIRE" } }, "BRK.B")).toBe("0001067983");
  });
});
