import { describe, expect, test } from "bun:test";
import { cikForTicker, fundFilingUrls, latestNportFiling } from "./client";
import { parseHoldings } from "./model";

function holding(name: string, body: string, value: number): string {
  return `<invstOrSec><name>${name}</name>${body}<valUSD>${value}</valUSD><pctVal>${value / 10}</pctVal></invstOrSec>`;
}

describe("fund holdings parsing", () => {
  test("reads the report date, net assets, and the 25 largest holdings", () => {
    const numbered = Array.from({ length: 26 }, (_, index) => {
      const value = index + 1;
      return holding(`Name ${value}`, `<cusip>CUSIP${value}</cusip><identifiers><isin value="US${value}"/></identifiers>`, value);
    }).join("");
    const xml = `<?xml version="1.0"?>
      <edgarSubmission>
        <formData>
          <genInfo>
            <repPdEnd>2026-09-30</repPdEnd>
            <repPdDate>2026-06-30</repPdDate>
          </genInfo>
          <fundInfo>
            <totAssets>1</totAssets>
            <netAssets>781188872106.76</netAssets>
          </fundInfo>
          <invstOrSecs>
            ${holding("S&amp;P Deposit", `<cusip></cusip><identifiers><isin value="US0000000001"/></identifiers>`, 1000)}
            ${holding("Collateral Note", `<identifiers><cusip value="436440101"/><isin value="US4364401012"/></identifiers>`, 500)}
            ${numbered}
          </invstOrSecs>
        </formData>
      </edgarSubmission>`;

    const portfolio = parseHoldings(xml);
    expect(portfolio.period).toBe("2026-06-30");
    expect(portfolio.netAssets).toBe(781188872106.76);
    expect(portfolio.holdings).toHaveLength(25);
    expect(portfolio.holdings[0]).toMatchObject({ name: "S&P Deposit", identifier: "US0000000001", value: 1000, percent: 100 });
    expect(portfolio.holdings[1]).toMatchObject({ name: "Collateral Note", identifier: "436440101", value: 500 });
    expect(portfolio.holdings[2]).toMatchObject({ name: "Name 26", identifier: "CUSIP26" });
    expect(portfolio.holdings.some((row) => row.name === "Name 1" || row.name === "Name 2" || row.name === "Name 3")).toBe(false);
    expect(parseHoldings("<edgarSubmission></edgarSubmission>")).toMatchObject({ period: null, netAssets: null, holdings: [] });
  });

  test("maps a ticker to a 10-digit CIK and keeps the newest portfolio filing", () => {
    expect(cikForTicker({
      "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
      "1": { cik_str: 884394, ticker: "SPY", title: "SPDR S&P 500 ETF TRUST" },
    }, "spy")).toBe("0000884394");
    expect(cikForTicker({ "0": { cik_str: 1, ticker: "A" } }, "SPY")).toBeNull();

    expect(latestNportFiling({
      filings: {
        recent: {
          form: ["10-K", "NPORT-P/A", "NPORT-P", "NPORT-P"],
          accessionNumber: ["a", "b", "0001-old", "0002-new"],
          primaryDocument: ["x.htm", "amend.xml", "old.xml", "xslFormNPORT-P_X01/primary_doc.xml"],
          filingDate: ["2026-09-01", "2026-08-01", "2026-02-01", "2026-05-01"],
        },
      },
    })).toEqual({
      accession: "0002-new",
      primaryDocument: "xslFormNPORT-P_X01/primary_doc.xml",
      filingDate: "2026-05-01",
    });
    expect(latestNportFiling({ filings: { recent: { form: ["10-K"] } } })).toBeNull();
  });

  test("requests the filed XML rather than the styled viewer", () => {
    expect(fundFilingUrls("0000884394", "0001410368-26-089410", "xslFormNPORT-P_X01/primary_doc.xml")).toEqual({
      xml: "https://www.sec.gov/Archives/edgar/data/884394/000141036826089410/primary_doc.xml",
      declared: "https://www.sec.gov/Archives/edgar/data/884394/000141036826089410/xslFormNPORT-P_X01/primary_doc.xml",
    });
  });
});
