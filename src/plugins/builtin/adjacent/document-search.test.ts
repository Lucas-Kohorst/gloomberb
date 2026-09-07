import { describe, expect, test } from "bun:test";
import { cftcDetailToSearchDocument, cftcFilingToDocumentHit, normalizeCftcDocumentQuery } from "./document-search";
import type { CftcFiling } from "./types";

describe("CFTC document discovery", () => {
  test("removes routing words without losing the filing subject", () => {
    expect(normalizeCftcDocumentQuery("ART CFTC Kalshi filings")).toBe("Kalshi");
    expect(normalizeCftcDocumentQuery("SRCH crude oil document")).toBe("crude oil");
    expect(normalizeCftcDocumentQuery("CFTC filings")).toBe("");
  });

  test("keeps the provider-local filing ID and metadata needed by the reader", () => {
    const filing: CftcFiling = {
      id: 742,
      title: "Kalshi contract certification",
      feed: "dcm_products",
      orgCode: "KEX",
      status: "Certified",
      statusDate: new Date("2026-08-20T00:00:00Z"),
      firstSeenAt: new Date("2026-08-21T12:00:00Z"),
      docCount: 2,
      description: "New event contracts",
    };
    expect(cftcFilingToDocumentHit(filing)).toMatchObject({
      id: "742",
      title: "Kalshi contract certification",
      publishedAt: "2026-08-21T12:00:00.000Z",
      snippet: "New event contracts",
      source: "CFTC",
      metadata: { orgCode: "KEX", status: "Certified", feed: "dcm_products" },
    });
  });

  test("loads markdown when cached filing dates have been JSON hydrated as strings", () => {
    const filing = {
      id: 987654,
      title: "Kalshi Search Discovery Fixture",
      feed: "dcm_products",
      orgCode: "KALSHI",
      status: "Certified",
      statusDate: "2026-09-07T00:00:00.000Z",
      firstSeenAt: "2026-09-07T12:00:00.000Z",
      docCount: 1,
    } as unknown as CftcFiling;
    const document = cftcDetailToSearchDocument("987654", {
      filing,
      markdown: "# Kalshi Search Discovery Fixture\n\nSelected filing 987654 body.",
      sourceUrl: "https://www.cftc.gov/",
      documents: [{ title: "Filing attachment", url: "https://www.cftc.gov/fixture.pdf" }],
    });
    expect(document.markdown).toBe("Selected filing 987654 body.");
    expect(document.metadata?.date).toBe("2026-09-07T12:00:00.000Z");
  });
});
