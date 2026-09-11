import { describe, expect, test } from "bun:test";
import {
  matchesCampaignSearch,
  parseCampaignDate,
  parsePerformancePct,
  parseShortCampaignsHtml,
  SHORT_REPORT_MARKUP_ERROR,
} from "./client";

const HEADER_TABLE = `
<html><body>
<table class="wp-list-table widefat fixed striped">
  <thead><tr><th>Date</th><th>Target Company</th><th>Short Seller</th><th>Performance</th></tr></thead>
  <tbody>
    <tr>
      <td>Mar 5, 2024</td>
      <td><a href="/reports/acme-corp">Acme Corp (ACME)</a></td>
      <td>Muddy Waters</td>
      <td>-12.4%</td>
    </tr>
    <tr>
      <td>2024-01-18</td>
      <td><a href="https://shortreportimpact.com/reports/beta">Beta Industries</a></td>
      <td>Hindenburg Research</td>
      <td>+3.1%</td>
    </tr>
  </tbody>
</table>
</body></html>
`;

const SHUFFLED_HEADER_TABLE = `
<table><tr><th>Short Seller</th><th>Performance since report</th><th>Company</th><th>Announced</th></tr>
<tr><td>Citron Research</td><td>(8.1%)</td><td>Gamma Co</td><td>Jan 3rd, 2023</td></tr>
</table>
`;

const HEADERLESS_TABLE = `
<table>
<tr><td>05/12/2023</td><td><a href="/r/delta">Delta Ltd (DLTA)</a></td><td>Spruce Point</td><td>N/A</td></tr>
</table>
`;

describe("short-campaign parser", () => {
  test("maps header columns regardless of class soup", () => {
    const page = parseShortCampaignsHtml(HEADER_TABLE, "https://shortreportimpact.com");
    expect(page.campaigns).toHaveLength(2);
    expect(page.campaigns[0]).toMatchObject({
      target: "Acme Corp",
      ticker: "ACME",
      seller: "Muddy Waters",
      performancePct: -12.4,
      reportUrl: "https://shortreportimpact.com/reports/acme-corp",
    });
    expect(page.campaigns[0]!.date.toISOString().slice(0, 10)).toBe("2024-03-05");
    expect(page.campaigns[1]).toMatchObject({
      target: "Beta Industries",
      ticker: null,
      seller: "Hindenburg Research",
      performancePct: 3.1,
    });
  });

  test("follows shuffled header order and ordinal dates", () => {
    const page = parseShortCampaignsHtml(SHUFFLED_HEADER_TABLE);
    expect(page.campaigns).toHaveLength(1);
    expect(page.campaigns[0]).toMatchObject({
      target: "Gamma Co",
      seller: "Citron Research",
      performancePct: -8.1,
    });
    expect(page.campaigns[0]!.date.toISOString().slice(0, 10)).toBe("2023-01-03");
  });

  test("sniffs columns without a header row", () => {
    const page = parseShortCampaignsHtml(HEADERLESS_TABLE);
    expect(page.campaigns).toHaveLength(1);
    expect(page.campaigns[0]).toMatchObject({
      target: "Delta Ltd",
      ticker: "DLTA",
      seller: "Spruce Point",
      performancePct: null,
    });
    expect(page.campaigns[0]!.date.toISOString().slice(0, 10)).toBe("2023-05-12");
  });

  test("decodes entities and strips nested tags", () => {
    const page = parseShortCampaignsHtml(`
      <table><tr><th>Date</th><th>Target</th><th>Seller</th><th>Return</th></tr>
      <tr><td>Feb 1, 2024</td><td><span><strong>Fish &amp; Chips Co</strong></span></td>
      <td>Blue <em>Orca</em></td><td>-1.5%</td></tr></table>
    `);
    expect(page.campaigns[0]).toMatchObject({
      target: "Fish & Chips Co",
      seller: "Blue Orca",
    });
  });

  test("skips pagination rows and dedupes repeats", () => {
    const page = parseShortCampaignsHtml(`
      <table><tr><th>Date</th><th>Target</th><th>Seller</th><th>Perf</th></tr>
      <tr><td>Feb 1, 2024</td><td>Epsilon Inc</td><td>Kerrisdale</td><td>-2%</td></tr>
      <tr><td>Feb 1, 2024</td><td>Epsilon Inc</td><td>Kerrisdale</td><td>-2%</td></tr>
      <tr><td colspan="4">Load more</td></tr></table>
    `);
    expect(page.campaigns).toHaveLength(1);
  });

  test("throws a clear error when the markup is unrecognizable", () => {
    expect(() => parseShortCampaignsHtml("<html><body><div>redesigned</div></body></html>"))
      .toThrow(SHORT_REPORT_MARKUP_ERROR);
    expect(() => parseShortCampaignsHtml("<table><tr><td>unrelated</td></tr></table>"))
      .toThrow(SHORT_REPORT_MARKUP_ERROR);
  });

  test("performance parsing covers signs, parens, and missing values", () => {
    expect(parsePerformancePct("+12.5%")).toBe(12.5);
    expect(parsePerformancePct("-3.2%")).toBe(-3.2);
    expect(parsePerformancePct("(8.1%)")).toBe(-8.1);
    expect(parsePerformancePct("N/A")).toBeNull();
    expect(parsePerformancePct("pending")).toBeNull();
    expect(parsePerformancePct("—")).toBeNull();
    expect(parsePerformancePct("")).toBeNull();
  });

  test("date parsing covers common listing formats", () => {
    expect(parseCampaignDate("Mar 5, 2024")?.toISOString().slice(0, 10)).toBe("2024-03-05");
    expect(parseCampaignDate("2024-03-05")?.toISOString().slice(0, 10)).toBe("2024-03-05");
    expect(parseCampaignDate("03/05/2024")?.toISOString().slice(0, 10)).toBe("2024-03-05");
    expect(parseCampaignDate("not a date")).toBeNull();
    expect(parseCampaignDate("")).toBeNull();
  });

  test("search matches target, ticker, and seller case-insensitively", () => {
    const page = parseShortCampaignsHtml(HEADER_TABLE);
    const [acme] = page.campaigns;
    expect(matchesCampaignSearch(acme!, "acme")).toBe(true);
    expect(matchesCampaignSearch(acme!, "ACME")).toBe(true);
    expect(matchesCampaignSearch(acme!, "muddy")).toBe(true);
    expect(matchesCampaignSearch(acme!, "hindenburg")).toBe(false);
    expect(matchesCampaignSearch(acme!, "")).toBe(true);
  });
});
