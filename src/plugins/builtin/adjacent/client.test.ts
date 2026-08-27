import { afterEach, describe, expect, test } from "bun:test";
import { AdjacentClient } from "./client";
import {
  filingKind,
  filingListTimestamp,
  filingListTitle,
  stripLeadingHeading,
  stripMarkdownHeader,
} from "./filings-format";
import type { CftcFiling } from "./types";

const HEX_MARKET_ID = "polymarket:0x80b3af88cb9919808da1ce86b9794a0957f96ec98c29319dd7ba65e9744d82b1";

type HostedFlag = { __GLOOM_CLOUD_HOSTED?: boolean };

function setHosted(hosted: boolean): void {
  const flag = globalThis as HostedFlag;
  if (hosted) flag.__GLOOM_CLOUD_HOSTED = true;
  else delete flag.__GLOOM_CLOUD_HOSTED;
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match?.[1] ?? null;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return value;
  }
  return null;
}

describe("AdjacentClient paths", () => {
  const originalFetch = globalThis.fetch;
  let requested: Array<{ url: string; authorization: string | null }>;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setHosted(false);
  });

  function mockFetch(body: unknown = { data: [] }): void {
    requested = [];
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      requested.push({
        url,
        authorization: headerValue(init?.headers, "Authorization"),
      });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  }

  test("hosted uses worker auth prefixes even without a browser key", async () => {
    setHosted(true);
    mockFetch();
    const client = new AdjacentClient();

    await client.getSimilarMarkets(HEX_MARKET_ID);
    await client.getLatestNews(20);
    await client.getNews({ limit: 50, offset: 10 });
    await client.getMarketNews(HEX_MARKET_ID);
    await client.searchMarkets("bitcoin", 8, "polymarket");
    await client.getMarketPrices(HEX_MARKET_ID, "1h");

    expect(requested.map((entry) => entry.url)).toEqual([
      `/api/data/adjacent/markets/${HEX_MARKET_ID}/similar`,
      "/api/data/adjacent/news/latest?per_page=20",
      "/api/data/adjacent/news?limit=50&offset=10",
      `/api/data/adjacent/markets/${HEX_MARKET_ID}/news?per_page=20`,
      "/api/data/adjacent/markets?search=bitcoin&per_page=8&page=1&platform=polymarket",
      `/api/data/adjacent/markets/${HEX_MARKET_ID}/prices?interval=1hour`,
    ]);
    expect(requested.every((entry) => !entry.url.includes("/public/"))).toBe(true);
    expect(requested.every((entry) => entry.authorization == null)).toBe(true);
  });

  test("desktop with a user key uses auth prefixes and Bearer", async () => {
    setHosted(false);
    mockFetch();
    const client = new AdjacentClient({ apiKey: "ak_test" });

    await client.getSimilarMarkets("kalshi:KXPRESPARTY-2028-D");
    await client.searchMarkets("senate", 5);
    await client.getMarketNews("kalshi:KXPRESPARTY-2028-D");
    await client.getNews({ limit: 25 });

    expect(requested.map((entry) => entry.url)).toEqual([
      "https://api.adjacent.markets/api/v1/markets/kalshi:KXPRESPARTY-2028-D/similar",
      "https://api.adjacent.markets/api/v1/markets?search=senate&per_page=5&page=1",
      "https://api.adjacent.markets/api/v1/markets/kalshi:KXPRESPARTY-2028-D/news?per_page=20",
      "https://api.adjacent.markets/api/v1/news?limit=25",
    ]);
    expect(requested.every((entry) => entry.authorization === "Bearer ak_test")).toBe(true);
    expect(requested.every((entry) => !entry.url.includes("/public/"))).toBe(true);
  });

  test("desktop without a key keeps public market paths but not public similar or news list", async () => {
    setHosted(false);
    mockFetch();
    const client = new AdjacentClient();

    await client.searchMarkets("bitcoin", 8);
    await client.getSimilarMarkets(HEX_MARKET_ID);
    await client.getLatestNews(15);
    await client.getMarketNews(HEX_MARKET_ID);

    expect(requested[0]?.url).toBe(
      "https://api.adjacent.markets/api/v1/public/markets?search=bitcoin&per_page=8&page=1&scope=all",
    );
    expect(requested[1]?.url).toBe(
      `https://api.adjacent.markets/api/v1/markets/${HEX_MARKET_ID}/similar`,
    );
    expect(requested[2]?.url).toBe("https://api.adjacent.markets/api/v1/news/latest?per_page=15");
    expect(requested[3]?.url).toBe(
      `https://api.adjacent.markets/api/v1/public/markets/${HEX_MARKET_ID}/news?per_page=20`,
    );
    expect(requested.some((entry) => /q=/.test(entry.url))).toBe(false);
    expect(requested.some((entry) => entry.url.includes("public/markets/") && entry.url.endsWith("/similar"))).toBe(false);
  });

  test("concurrent getMarketNews shares one in-flight request", async () => {
    setHosted(false);
    requested = [];
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      requested.push({
        url,
        authorization: headerValue(init?.headers, "Authorization"),
      });
      await Bun.sleep(15);
      return new Response(JSON.stringify({ news: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const client = new AdjacentClient({ apiKey: "ak_test" });
    await Promise.all([
      client.getMarketNews("kalshi:KXTEST-1"),
      client.getMarketNews("kalshi:KXTEST-1", { limit: 20 }),
    ]);
    expect(requested).toHaveLength(1);
    expect(requested[0]?.url).toBe(
      "https://api.adjacent.markets/api/v1/markets/kalshi:KXTEST-1/news?per_page=20",
    );
  });

  test("unwraps similar { data } payloads for the UI", async () => {
    setHosted(false);
    mockFetch({
      data: [{
        market_id: "kalshi:KXNBA-26-NYK",
        question: "Will the New York win the 2026 Pro Basketball Finals?",
        latest_price: 37,
        similarity: 0.91,
        platform: "kalshi",
      }],
    });
    const client = new AdjacentClient({ apiKey: "ak_test" });
    const response = await client.getSimilarMarkets("kalshi:KXNBA-26-BOS");
    expect(response.markets?.[0]).toMatchObject({
      id: "kalshi:KXNBA-26-NYK",
      platform: "kalshi",
      title: "Will the New York win the 2026 Pro Basketball Finals?",
      yes_price: 37,
      similarity: 0.91,
    });
  });

  test("routes filings to the public tier without a key and the auth tier with one", async () => {
    setHosted(false);
    mockFetch({ data: [], meta: {} });

    await new AdjacentClient().listFilings({ perPage: 5 });
    await new AdjacentClient({ apiKey: "ak_test" }).listFilings({ perPage: 5 });

    expect(requested[0]?.url).toStartWith("https://api.adjacent.markets/api/v1/public/filings?");
    expect(requested[1]?.url).toStartWith("https://api.adjacent.markets/api/v1/filings?");
    expect(requested[1]?.authorization).toBe("Bearer ak_test");
  });

  test("maps snake_case filing fields and skips rows with no id or title", async () => {
    setHosted(false);
    mockFetch({
      data: [
        {
          id: 63380,
          title: "NFL Starter Designation Contracts",
          feed: "dcm_products",
          org_code: "QCEX",
          status: "Certified",
          status_date: "2026-08-25",
          doc_count: 3,
          product_type: "Swap (Binary Option)",
          category: "Event",
          receipt_date: "2026-08-20",
        },
        { title: "no id" },
        { id: 5 },
      ],
      meta: { total: 703, page: 1, per_page: 5, total_pages: 141, has_next: true },
    });

    const page = await new AdjacentClient().listFilings({ perPage: 5 });
    expect(page.filings).toHaveLength(1);
    const filing = page.filings[0]!;
    expect(filing.id).toBe(63380);
    expect(filing.orgCode).toBe("QCEX");
    expect(filing.docCount).toBe(3);
    expect(filing.productType).toBe("Swap (Binary Option)");
    expect(filing.statusDate.toISOString().slice(0, 10)).toBe("2026-08-25");
    expect(filing.receiptDate?.toISOString().slice(0, 10)).toBe("2026-08-20");
    expect(page.meta).toMatchObject({ total: 703, hasNext: true, hasPrev: false });
  });

  test("sends the search term as the relevance search filter", async () => {
    setHosted(false);
    mockFetch({ data: [], meta: {} });
    await new AdjacentClient().listFilings({ search: "  NFL  ", perPage: 10 });
    const url = new URL(requested[0]!.url);
    expect(url.searchParams.get("search")).toBe("NFL");
    expect(url.searchParams.get("q")).toBeNull();
    expect(url.searchParams.get("per_page")).toBe("10");
  });

  test("reads the filing detail envelope and returns null on an unknown id", async () => {
    setHosted(false);
    mockFetch({
      filing: {
        id: 1,
        title: "T",
        feed: "dco",
        org_code: "CME",
        status: "Registered",
        status_date: "2026-01-02",
        doc_count: 1,
      },
      markdown: "# T\n\n- **Id:** 1\n\n## Attachments\n\nbody text",
      documents: [{ url: "https://cftc.gov/a.pdf", title: "Cover Letter" }, { title: "no url" }],
      source_url: "https://cftc.gov/filing/1",
    });

    const detail = await new AdjacentClient().getFilingDetail(1);
    expect(requested[0]?.url).toBe(
      "https://api.adjacent.markets/api/v1/public/filings/1/markdown",
    );
    expect(detail?.sourceUrl).toBe("https://cftc.gov/filing/1");
    expect(detail?.documents).toEqual([
      { url: "https://cftc.gov/a.pdf", title: "Cover Letter" },
    ]);

    globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
    expect(await new AdjacentClient().getFilingDetail(2)).toBeNull();
  });
});

describe("stripMarkdownHeader", () => {
  test("drops the H1, the facts block, and a description that restates the title", () => {
    const markdown = [
      "# NFL Starter Designation Contracts",
      "",
      "- **Id:** 63380",
      "- **Org:** QCEX",
      "- **Status:** Certified (2026-08-25)",
      "",
      "## Description",
      "",
      "NFL Starter Designation Contracts",
      "",
      "## Attachments",
      "",
      "real body",
    ].join("\n");

    expect(stripMarkdownHeader(markdown, "NFL Starter Designation Contracts"))
      .toBe("## Attachments\n\nreal body");
  });

  test("keeps a description that adds information beyond the title", () => {
    const markdown = "# T\n\n- **Id:** 1\n\n## Description\n\nSomething else entirely";
    expect(stripMarkdownHeader(markdown, "T"))
      .toBe("## Description\n\nSomething else entirely");
  });

  test("passes through markdown that has no header block", () => {
    expect(stripMarkdownHeader("just text", "T")).toBe("just text");
  });
});

describe("filingListTitle", () => {
  function filing(overrides: Partial<CftcFiling> & Pick<CftcFiling, "feed" | "title">): CftcFiling {
    return {
      id: 1,
      orgCode: "KEX",
      status: "",
      statusDate: new Date("2026-08-26"),
      docCount: 1,
      ...overrides,
    };
  }

  test("labels product self-certs as new contracts and keeps withdrawn rows distinct", () => {
    const certified = filing({
      feed: "dcm_products",
      title: "Will there be at least [count] EF2+ tornadoes in Alabama in [time period]?",
      status: "Certified",
    });
    const withdrawn = filing({
      id: 2,
      feed: "dcm_products",
      title: "Will there be at least [count] EF2+ tornadoes in Alabama in [time period]?",
      status: "Withdrawn",
    });
    expect(filingKind(certified)).toBe("new-contract");
    expect(filingListTitle(certified)).toBe(
      "New contract · Certified | Will there be at least [count] EF2+ tornadoes in Alabama in [time period]?",
    );
    expect(filingListTitle(withdrawn)).toBe(
      "New contract · Withdrawn | Will there be at least [count] EF2+ tornadoes in Alabama in [time period]?",
    );
  });

  test("labels rule feeds as amendments", () => {
    expect(filingKind(filing({
      feed: "ptc_dcm_rules",
      title: "Weekly notification of rule amendments",
    }))).toBe("amendment");
    expect(filingListTitle(filing({
      feed: "dco_rules",
      title: "Changes to cash spreads",
      status: "Notified",
    }))).toBe("Amendment · Notified | Changes to cash spreads");
  });
});

describe("filingListTimestamp", () => {
  test("prefers firstSeenAt over statusDate", () => {
    const firstSeenAt = new Date("2026-08-27T12:34:56.000Z");
    const filing: CftcFiling = {
      id: 1,
      feed: "dcm_products",
      title: "A filing",
      orgCode: "KEX",
      status: "Certified",
      statusDate: new Date("2026-08-26T12:34:56.000Z"),
      firstSeenAt,
      docCount: 1,
    };

    expect(filingListTimestamp(filing)).toBe(firstSeenAt);
  });
});

describe("stripLeadingHeading", () => {
  test("drops the H1 but keeps the facts block", () => {
    expect(stripLeadingHeading("# Title\n\n- **Id:** 1\n- **Org:** CME\n\nbody"))
      .toBe("- **Id:** 1\n- **Org:** CME\n\nbody");
  });

  test("leaves markdown with no leading heading alone", () => {
    expect(stripLeadingHeading("- **Id:** 1\n\nbody")).toBe("- **Id:** 1\n\nbody");
    expect(stripLeadingHeading("## Not an H1")).toBe("## Not an H1");
  });
});
