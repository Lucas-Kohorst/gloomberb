import { describe, expect, test } from "bun:test";
import type { SecFilingItem } from "../../../types/data-provider";
import { filingLookupQuery, filingToArticle, looksLikeFilingQuery } from "./filing-article";
import { filingMatchesForms, isPeriodicReportForm, parseFormsSetting } from "./forms";

const filing = (form: string): SecFilingItem => ({
  accessionNumber: "0001",
  form,
  filingDate: new Date("2026-02-01T00:00:00Z"),
  cik: "320193",
  companyName: "Apple Inc.",
  ticker: "AAPL",
  filingUrl: "https://www.sec.gov/Archives/edgar/data/320193/0001/aapl.htm",
});

describe("periodic report forms", () => {
  test("accepts 10-K and 10-Q including amendments", () => {
    expect(isPeriodicReportForm("10-K")).toBe(true);
    expect(isPeriodicReportForm("10-q/a")).toBe(true);
    expect(isPeriodicReportForm("8-K")).toBe(false);
  });

  test("settings filter keeps only requested forms", () => {
    const forms = parseFormsSetting("10-K, 10-Q");
    expect(filingMatchesForms("10-K", forms)).toBe(true);
    expect(filingMatchesForms("8-K", forms)).toBe(false);
    expect(filingMatchesForms("10-K", null)).toBe(true);
  });

  test("article mapping keeps ticker and form for ART search", () => {
    const article = filingToArticle(filing("10-K"), "Item 1. Business");
    expect(article.id).toBe("sec:0001");
    expect(article.tickers).toEqual(["AAPL"]);
    expect(article.topics).toContain("10-K");
    expect(article.topics).toContain("10k");
    expect(article.body).toBe("Item 1. Business");
    expect(article.origin).toBe("sec-edgar");
  });

  test("filing queries match 10-K / 10-Q phrasing", () => {
    expect(looksLikeFilingQuery("ART 10-K AAPL")).toBe(true);
    expect(looksLikeFilingQuery("latest 10q")).toBe(true);
    expect(looksLikeFilingQuery("nvda")).toBe(false);
  });

  test("EDGAR lookup strips ART and form tokens", () => {
    expect(filingLookupQuery("ART 10-K AAPL")).toBe("AAPL");
    expect(filingLookupQuery("10q microsoft")).toBe("microsoft");
    expect(filingLookupQuery("ART filings")).toBe("");
  });
});
