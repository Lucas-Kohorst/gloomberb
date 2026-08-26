import { afterEach, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import { AdjacentDevClient } from "./client";
import { stripLeadingHeading, stripMarkdownHeader } from "./format";

function stubJson(body: unknown, requested: string[]): void {
  setHttpFetchTransport((url) => {
    requested.push(url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

afterEach(() => {
  setHttpFetchTransport(null);
});

describe("AdjacentDevClient", () => {
  // The pane shipped pointing at `/filings`, which 404s. Both tiers live under
  // /api/v1, and the unauthenticated tier under /api/v1/public.
  test("routes to the public tier without a key and the auth tier with one", async () => {
    const requested: string[] = [];
    stubJson({ data: [], meta: {} }, requested);

    await new AdjacentDevClient({}).listFilings({ perPage: 5 });
    await new AdjacentDevClient({ apiKey: "ak_test" }).listFilings({ perPage: 5 });

    expect(requested[0]).toStartWith(
      "https://api.dev.adjacent.markets/api/v1/public/filings?",
    );
    expect(requested[1]).toStartWith("https://api.dev.adjacent.markets/api/v1/filings?");
  });

  test("maps snake_case filing fields and skips rows with no id or title", async () => {
    const requested: string[] = [];
    stubJson({
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
    }, requested);

    const page = await new AdjacentDevClient({}).listFilings({ perPage: 5 });

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

  test("sends the search term as the lexical q filter", async () => {
    const requested: string[] = [];
    stubJson({ data: [], meta: {} }, requested);

    await new AdjacentDevClient({}).listFilings({ q: "  NFL  ", perPage: 10 });

    const url = new URL(requested[0]!);
    expect(url.searchParams.get("q")).toBe("NFL");
    expect(url.searchParams.get("per_page")).toBe("10");
  });

  test("reads the filing detail envelope and returns null on an unknown id", async () => {
    const requested: string[] = [];
    stubJson({
      filing: { id: 1, title: "T", feed: "dco", org_code: "CME", status: "Registered", status_date: "2026-01-02", doc_count: 1 },
      markdown: "# T\n\n- **Id:** 1\n\n## Attachments\n\nbody text",
      documents: [{ url: "https://cftc.gov/a.pdf", title: "Cover Letter" }, { title: "no url" }],
      source_url: "https://cftc.gov/filing/1",
    }, requested);

    const detail = await new AdjacentDevClient({}).getFilingDetail(1);
    expect(requested[0]).toBe(
      "https://api.dev.adjacent.markets/api/v1/public/filings/1/markdown",
    );
    expect(detail?.sourceUrl).toBe("https://cftc.gov/filing/1");
    expect(detail?.documents).toEqual([
      { url: "https://cftc.gov/a.pdf", title: "Cover Letter" },
    ]);

    setHttpFetchTransport(() => Promise.resolve(new Response("", { status: 404 })));
    expect(await new AdjacentDevClient({}).getFilingDetail(2)).toBeNull();
  });
});

describe("stripMarkdownHeader", () => {
  // The detail title and meta row already carry the H1 and the facts block.
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

describe("stripLeadingHeading", () => {
  // The reader has no meta row, so the facts block stays; only the duplicated
  // title comes off.
  test("drops the H1 but keeps the facts block", () => {
    expect(stripLeadingHeading("# Title\n\n- **Id:** 1\n- **Org:** CME\n\nbody"))
      .toBe("- **Id:** 1\n- **Org:** CME\n\nbody");
  });

  test("leaves markdown with no leading heading alone", () => {
    expect(stripLeadingHeading("- **Id:** 1\n\nbody")).toBe("- **Id:** 1\n\nbody");
    expect(stripLeadingHeading("## Not an H1")).toBe("## Not an H1");
  });
});
