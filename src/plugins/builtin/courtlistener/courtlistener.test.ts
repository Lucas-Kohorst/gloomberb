import { describe, expect, test } from "bun:test";
import {
  buildSearchUrl,
  LATEST_DOCKET_QUERY,
  normalizeCourtListenerDocumentQuery,
  parseLawsuit,
  parseOpinionDetail,
  parseSearchPage,
  resolveCourtListenerApiToken,
  setCourtListenerApiToken,
} from "./client";
import { COURTLISTENER_API_BASE_URL } from "./types";

const SEARCH_FIXTURE = {
  count: 2,
  next: null,
  previous: null,
  results: [
    {
      absolute_url: "/opinion/10882239/trump-v-barbara/",
      caseName: "Trump v. Barbara",
      caseNameFull: "",
      citation: [],
      citeCount: 12,
      cluster_id: 10882239,
      court: "Supreme Court of the United States",
      court_citation_string: "SCOTUS",
      court_id: "scotus",
      dateFiled: "2026-06-30",
      docketNumber: "25-365",
      judge: "John G. Roberts",
      status: "Published",
      opinions: [
        {
          id: 11349764,
          snippet:
            "  Syllabus\n\n   NOTE: Where it is feasible,\n  a syllabus will be released.  ",
          download_url: "https://www.supremecourt.gov/opinions/25pdf/25-365_4hdj.pdf",
          type: "combined-opinion",
        },
      ],
    },
    {
      absolute_url: "/opinion/10880244/monsanto-v-durnell/",
      caseName: "Monsanto v. Durnell",
      citeCount: 0,
      cluster_id: 10880244,
      court: "Supreme Court of the United States",
      court_citation_string: "SCOTUS",
      dateFiled: "2026-06-25",
      docketNumber: "24-1068",
      judge: "Brett Kavanaugh",
      status: "Published",
      opinions: [{ id: 11347763, snippet: "OCTOBER TERM, 2025", download_url: "" }],
    },
    // Malformed entries must be skipped, never drop the page.
    { cluster_id: 999, court: "Nowhere", opinions: [] },
    "not-an-object",
    null,
  ],
};

describe("courtlistener search url", () => {
  test("builds a RECAP docket query newest-first", () => {
    const url = buildSearchUrl("Apple Inc.", { limit: 25 });
    expect(url.startsWith(`${COURTLISTENER_API_BASE_URL}/search/?`)).toBe(true);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("q")).toBe("Apple Inc.");
    expect(params.get("type")).toBe("r");
    expect(params.get("order_by")).toBe("dateFiled desc");
    expect(params.get("page_size")).toBe("25");
    expect(url).not.toContain("api_key");
    expect(url).not.toContain("token");
  });

  test("blank queries request the last week of dockets", () => {
    const params = new URLSearchParams(buildSearchUrl("").split("?")[1]);
    expect(params.get("q")).toBe(LATEST_DOCKET_QUERY);
    expect(params.get("type")).toBe("r");
    expect(params.get("order_by")).toBe("dateFiled desc");
  });
});

describe("courtlistener search parsing", () => {
  test("parses v4 hits into lawsuits and skips malformed entries", () => {
    const page = parseSearchPage(SEARCH_FIXTURE);
    expect(page.total).toBe(2);
    expect(page.lawsuits).toHaveLength(2);

    const first = page.lawsuits[0]!;
    expect(first.id).toBe("cluster-10882239");
    expect(first.kind).toBe("opinion");
    expect(first.caseName).toBe("Trump v. Barbara");
    expect(first.court).toBe("Supreme Court of the United States");
    expect(first.courtCitation).toBe("SCOTUS");
    expect(first.dateFiled instanceof Date).toBe(true);
    expect(first.dateFiled.toISOString().startsWith("2026-06-30")).toBe(true);
    expect(first.docketNumber).toBe("25-365");
    expect(first.judge).toBe("John G. Roberts");
    expect(first.status).toBe("Published");
    expect(first.citeCount).toBe(12);
    expect(first.url).toBe(
      "https://www.courtlistener.com/opinion/10882239/trump-v-barbara/",
    );
    expect(first.downloadUrl).toBe(
      "https://www.supremecourt.gov/opinions/25pdf/25-365_4hdj.pdf",
    );
    // Snippet whitespace is collapsed for table/detail rendering.
    expect(first.snippet).toBe(
      "Syllabus NOTE: Where it is feasible, a syllabus will be released.",
    );
  });

  test("falls back to the opinion id when the cluster id is missing", () => {
    const lawsuit = parseLawsuit({
      caseName: "No Cluster v. Nobody",
      opinions: [{ id: 42, snippet: "hi" }],
    });
    expect(lawsuit?.id).toBe("opinion-42");
    expect(lawsuit?.opinionId).toBe("42");
    expect(lawsuit?.url).toBe("");
  });

  test("rejects entries without a case name", () => {
    expect(parseLawsuit({ cluster_id: 1, opinions: [] })).toBeNull();
    expect(parseLawsuit(null)).toBeNull();
  });

  test("caps results at the display cap", () => {
    const page = parseSearchPage(SEARCH_FIXTURE, 1);
    expect(page.lawsuits).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  test("falls back to the result count when count is missing", () => {
    const page = parseSearchPage({ results: SEARCH_FIXTURE.results });
    expect(page.lawsuits).toHaveLength(2);
    expect(page.total).toBe(2);
    expect(page.next).toBeNull();
  });

  test("returns an empty page for non-object payloads", () => {
    expect(parseSearchPage(null)).toEqual({ lawsuits: [], total: 0, next: null });
    expect(parseSearchPage("nope")).toEqual({ lawsuits: [], total: 0, next: null });
  });

  test("parses RECAP docket hits and keeps the next page cursor", () => {
    const page = parseSearchPage({
      count: 178,
      next: `${COURTLISTENER_API_BASE_URL}/search/?cursor=abc&q=Kalshi&type=r`,
      results: [{
        caseName: "Moran v. Kalshi Inc.",
        court: "District Court, E.D. Virginia",
        court_citation_string: "E.D. Va.",
        dateFiled: "2026-09-10",
        docketNumber: "1:26-cv-03008",
        docket_id: 74775891,
        docket_absolute_url: "/docket/74775891/moran-v-kalshi-inc/",
        assignedTo: "Leonie M. Brinkema",
        suitNature: "Other Statutory Actions",
        recap_documents: [{
          absolute_url: "/docket/74775891/1/moran-v-kalshi-inc/",
          snippet: "COMPLAINT FOR DAMAGES",
          description: "Complaint",
        }],
      }],
    });
    expect(page.total).toBe(178);
    expect(page.next).toContain("cursor=abc");
    expect(page.lawsuits[0]).toMatchObject({
      id: "docket-74775891",
      kind: "docket",
      caseName: "Moran v. Kalshi Inc.",
      courtCitation: "E.D. Va.",
      docketNumber: "1:26-cv-03008",
      judge: "Leonie M. Brinkema",
      snippet: "COMPLAINT FOR DAMAGES",
    });
  });

  test("drops placeholder and future-dated docket junk", () => {
    expect(parseLawsuit({
      caseName: "Miscellaneous Entry",
      docket_id: 1,
      dateFiled: "2026-09-01",
    })).toBeNull();
    expect(parseLawsuit({
      caseName: "Le Gros",
      docket_id: 2,
      dateFiled: "2079-11-23",
    })).toBeNull();
  });
});

describe("courtlistener document query", () => {
  test("strips LAW routing words so SRCH and ART keep the party name", () => {
    expect(normalizeCourtListenerDocumentQuery("LAW Kalshi")).toBe("Kalshi");
    expect(normalizeCourtListenerDocumentQuery("lawsuit docket Tesla")).toBe("Tesla");
  });
});

describe("courtlistener token", () => {
  test("stores a BYOK token without putting it in the search URL", () => {
    setCourtListenerApiToken("  secret-token  ");
    expect(resolveCourtListenerApiToken()).toBe("secret-token");
    expect(buildSearchUrl("Kalshi")).not.toContain("secret-token");
    setCourtListenerApiToken(undefined);
  });
});

describe("courtlistener opinion parsing", () => {
  test("prefers plain text for a single opinion object", () => {
    const detail = parseOpinionDetail({
      id: 11349764,
      plain_text: "Held: the judgment is affirmed.",
      html: "<p>Ignored when plain text exists.</p>",
      absolute_url: "/opinion/10882239/trump-v-barbara/",
    });
    expect(detail?.id).toBe("11349764");
    expect(detail?.title).toBe("Opinion 11349764");
    expect(detail?.text).toBe("Held: the judgment is affirmed.");
    expect(detail?.url).toBe(
      "https://www.courtlistener.com/opinion/10882239/trump-v-barbara/",
    );
  });

  test("strips html when plain text is missing", () => {
    const detail = parseOpinionDetail({
      id: 7,
      html: "<p>Hello <b>world</b></p><p>Second.</p>",
    });
    expect(detail?.text).toBe("Hello world Second.");
  });

  test("reads the first hit of a paged cluster lookup", () => {
    const detail = parseOpinionDetail({
      count: 1,
      results: [{ id: 9, snippet: "  paged\n  snippet  " }],
    });
    expect(detail?.id).toBe("9");
    expect(detail?.text).toBe("paged snippet");
  });

  test("rejects empty payloads", () => {
    expect(parseOpinionDetail(null)).toBeNull();
    expect(parseOpinionDetail({})).toBeNull();
    expect(parseOpinionDetail({ id: 1 })).toBeNull();
    expect(parseOpinionDetail({ count: 0, results: [] })).toBeNull();
  });
});
