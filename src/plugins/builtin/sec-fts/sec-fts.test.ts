import { afterEach, describe, expect, test } from "bun:test";
import {
  SEC_FTS_CONNECTION_ID,
  SEC_FTS_DOCUMENT_PROVIDER_ID,
  createSecFtsDocumentSearchProvider,
  normalizeSecFtsDocumentQuery,
  secFilingToDocumentHit,
  secFilingToSearchDocument,
  secFtsPlugin,
  type SecFtsClientLike,
} from "./index";
import {
  clearPendingConnectionReports,
  listConnectionSources,
} from "../connections/register";
import type { SecFilingItem } from "../../../types/data-provider";

afterEach(() => {
  clearPendingConnectionReports();
  try {
    secFtsPlugin.dispose?.();
  } catch {
    // Ignore: dispose is idempotent when the plugin was never set up.
  }
  clearPendingConnectionReports();
});

const APPLE_10Q: SecFilingItem = {
  accessionNumber: "0000320193-26-000020",
  form: "10-Q",
  filingDate: new Date("2026-07-31T00:00:00Z"),
  primaryDocument: "aapl-20260628.htm",
  primaryDocDescription: "Quarterly report",
  cik: "0000320193",
  companyName: "Apple Inc.",
  ticker: "AAPL",
  filingUrl:
    "https://www.sec.gov/Archives/edgar/data/320193/0000320193-26-000020-index.htm",
  primaryDocumentUrl:
    "https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260628.htm",
};

const ACME_8K: SecFilingItem = {
  accessionNumber: "0000999999-26-000001",
  form: "8-K",
  filingDate: new Date("2026-08-02T00:00:00Z"),
  primaryDocument: "acme-8k.htm",
  primaryDocDescription: "Current report",
  items: "2.02",
  cik: "0000999999",
  companyName: "Acme Corp",
  filingUrl:
    "https://www.sec.gov/Archives/edgar/data/999999/0000999999-26-000001-index.htm",
  primaryDocumentUrl:
    "https://www.sec.gov/Archives/edgar/data/999999/000099999926000001/acme-8k.htm",
};

function createStubClient(options: {
  filings?: SecFilingItem[];
  content?: string | null;
} = {}): SecFtsClientLike & {
  searchCalls: Array<{ query: string; count: number }>;
  contentCalls: Array<Pick<SecFilingItem, "primaryDocumentUrl" | "filingUrl" | "form">>;
} {
  const searchCalls: Array<{ query: string; count: number }> = [];
  const contentCalls: Array<
    Pick<SecFilingItem, "primaryDocumentUrl" | "filingUrl" | "form">
  > = [];
  const filings = options.filings ?? [APPLE_10Q, ACME_8K];
  const content = options.content ?? "Net sales increased year over year.";
  return {
    searchCalls,
    contentCalls,
    async searchFilings(query: string, count: number) {
      searchCalls.push({ query, count });
      return filings.slice(0, Math.max(count, 0));
    },
    async getFilingContent(
      filing: Pick<SecFilingItem, "primaryDocumentUrl" | "filingUrl" | "form">,
    ) {
      contentCalls.push(filing);
      return content;
    },
  };
}

function testSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("normalizeSecFtsDocumentQuery", () => {
  test("strips routing words without losing full-text terms", () => {
    expect(normalizeSecFtsDocumentQuery("ART SEC filings risk factors")).toBe("risk factors");
    expect(normalizeSecFtsDocumentQuery("SRCH Apple 10-Q")).toBe("Apple 10-Q");
    expect(normalizeSecFtsDocumentQuery("SEC filings")).toBe("");
  });
});

describe("secFilingToDocumentHit", () => {
  test("keeps the stable accession id with snippet and filing metadata", () => {
    expect(secFilingToDocumentHit(APPLE_10Q)).toMatchObject({
      id: "0000320193-26-000020",
      publishedAt: "2026-07-31T00:00:00.000Z",
      source: "SEC",
      documentType: "filing",
      url: APPLE_10Q.filingUrl,
      metadata: {
        form: "10-Q",
        cik: "0000320193",
        accessionNumber: "0000320193-26-000020",
        ticker: "AAPL",
      },
    });
    const hit = secFilingToDocumentHit(APPLE_10Q);
    expect(hit.title).toContain("Apple Inc.");
    expect(hit.title).toContain("10-Q");
    expect(hit.snippet).toContain("Quarterly report");
  });

  test("includes item numbers in the 8-K snippet", () => {
    expect(secFilingToDocumentHit(ACME_8K).snippet).toContain("2.02");
  });
});

describe("secFilingToSearchDocument", () => {
  test("keeps the hit id and prefers the primary document url", () => {
    const document = secFilingToSearchDocument(
      APPLE_10Q.accessionNumber,
      APPLE_10Q,
      "Net sales increased.",
    );
    expect(document.id).toBe(APPLE_10Q.accessionNumber);
    expect(document.markdown).toBe("Net sales increased.");
    expect(document.sourceUrl).toBe(APPLE_10Q.primaryDocumentUrl);
    expect(document.metadata).toMatchObject({ source: "SEC", form: "10-Q" });
  });

  test("falls back to the snippet when filing text is unavailable", () => {
    const document = secFilingToSearchDocument(ACME_8K.accessionNumber, ACME_8K, null);
    expect(document.markdown).toContain("2.02");
  });
});

describe("createSecFtsDocumentSearchProvider", () => {
  test("exposes the filing provider identity SRCH/ART routes to", () => {
    const provider = createSecFtsDocumentSearchProvider(createStubClient());
    expect(provider.id).toBe(SEC_FTS_DOCUMENT_PROVIDER_ID);
    expect(provider.documentTypes).toContain("filing");
    expect(provider.sourceId).toBe(SEC_FTS_CONNECTION_ID);
  });

  test("search maps stubbed EFTS hits and load fetches filing text", async () => {
    const stub = createStubClient();
    const provider = createSecFtsDocumentSearchProvider(stub);

    const hits = await provider.search("risk factors", testSignal(), { limit: 5 });
    expect(stub.searchCalls).toHaveLength(1);
    expect(stub.searchCalls[0]?.query).toBe("risk factors");
    expect(hits.map((hit) => hit.id)).toEqual([
      "0000320193-26-000020",
      "0000999999-26-000001",
    ]);

    const document = await provider.load(hits[0]!.id, testSignal());
    expect(stub.contentCalls).toHaveLength(1);
    expect(document.id).toBe("0000320193-26-000020");
    expect(document.markdown).toContain("Net sales increased");
    expect(document.sourceUrl).toBe(APPLE_10Q.primaryDocumentUrl);
  });

  test("search strips routing words before hitting the EFTS client", async () => {
    const stub = createStubClient();
    const provider = createSecFtsDocumentSearchProvider(stub);
    await provider.search("ART SEC filings risk factors", testSignal());
    expect(stub.searchCalls[0]?.query).toBe("risk factors");
  });

  test("blank queries short-circuit without touching the client", async () => {
    const stub = createStubClient();
    const provider = createSecFtsDocumentSearchProvider(stub);
    expect(await provider.search("   SEC filings  ", testSignal())).toEqual([]);
    expect(stub.searchCalls).toHaveLength(0);
  });

  test("load rejects unknown ids without fetching", async () => {
    const stub = createStubClient();
    const provider = createSecFtsDocumentSearchProvider(stub);
    await expect(provider.load("0000000000-00-000000", testSignal())).rejects.toThrow(
      "not found",
    );
    expect(stub.contentCalls).toHaveLength(0);
  });
});

describe("secFtsPlugin", () => {
  test("is a headless toggleable plugin with no panes", () => {
    expect(secFtsPlugin.id).toBe("sec-fts");
    expect(secFtsPlugin.toggleable).toBe(true);
    expect(secFtsPlugin.panes ?? []).toHaveLength(0);
    expect(secFtsPlugin.paneTemplates ?? []).toHaveLength(0);
  });

  test("setup registers the connection source and provider; dispose removes both", () => {
    const providers: Array<{ id: string }> = [];
    const ctx = {
      registerDocumentSearchProvider: (provider: { id: string }) => {
        providers.push(provider);
        return () => {
          const index = providers.indexOf(provider);
          if (index >= 0) providers.splice(index, 1);
        };
      },
    } as unknown as Parameters<NonNullable<typeof secFtsPlugin.setup>>[0];

    secFtsPlugin.setup?.(ctx);
    try {
      expect(listConnectionSources().some((source) => source.id === SEC_FTS_CONNECTION_ID)).toBe(
        true,
      );
      expect(providers.map((provider) => provider.id)).toContain(
        SEC_FTS_DOCUMENT_PROVIDER_ID,
      );
    } finally {
      secFtsPlugin.dispose?.();
    }
    expect(listConnectionSources().some((source) => source.id === SEC_FTS_CONNECTION_ID)).toBe(
      false,
    );
    expect(providers).toHaveLength(0);
  });
});
