import { describe, expect, test } from "bun:test";
import type { CloudSearchHit } from "../../../api-client";
import { appendUniqueHits, filterProviderDocumentHits, filtersToSaved } from "./model";

function hit(overrides: Partial<CloudSearchHit>): CloudSearchHit {
  return {
    id: "hit",
    docType: "filing",
    sourceId: "0000320193-26-000001",
    chunkIndex: 0,
    ticker: "AAPL",
    publishedAt: "2026-05-02T21:00:00.000Z",
    title: "Apple Inc. 10-Q",
    url: "https://example.com/filing",
    snippet: "gross margin",
    score: 1,
    metadata: {},
    ...overrides,
  };
}

describe("appendUniqueHits", () => {
  test("drops a document that arrives again under a different chunk", () => {
    const first = [hit({ id: "chunk-4", chunkIndex: 4 })];
    const second = [
      hit({ id: "chunk-9", chunkIndex: 9 }),
      hit({ id: "other", sourceId: "0000320193-26-000002" }),
    ];

    expect(appendUniqueHits(first, second).map((entry) => entry.id))
      .toEqual(["chunk-4", "other"]);
  });

  test("keeps documents of different types that share a source id", () => {
    const first = [hit({ id: "news", docType: "news", sourceId: "shared" })];
    const second = [hit({ id: "filing", docType: "filing", sourceId: "shared" })];

    expect(appendUniqueHits(first, second)).toHaveLength(2);
  });
});

describe("plugin document filters", () => {
  test("source selection stays local to the pane and cloud saved alerts", () => {
    const filters = { tickers: [], docTypes: ["filing"] as const, sourceIds: ["provider:filings"], range: "all" as const, sort: "relevance" as const };
    expect(filtersToSaved({ ...filters, docTypes: [...filters.docTypes] })).toEqual({ docTypes: ["filing"] });
  });

  test("applies portable ticker, range, and sort filters to provider metadata", () => {
    const hits = [
      { id: "old", title: "Old", publishedAt: "2026-08-01T00:00:00Z", keywords: ["AAPL"] },
      { id: "new", title: "New", publishedAt: "2026-09-01T00:00:00Z", metadata: { ticker: "AAPL" } },
      { id: "other", title: "Other", publishedAt: "2026-09-02T00:00:00Z", keywords: ["MSFT"] },
    ];
    const filtered = filterProviderDocumentHits(hits, {
      tickers: ["AAPL"], docTypes: [], range: "30d", sort: "newest",
    }, new Date("2026-09-07T00:00:00Z").getTime());
    expect(filtered.map((entry) => entry.id)).toEqual(["new"]);
  });
});
