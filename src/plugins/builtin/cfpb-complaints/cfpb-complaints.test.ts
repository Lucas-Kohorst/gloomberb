import { describe, expect, test } from "bun:test";
import {
  buildComplaintsUrl,
  complaintTotal,
  parseComplaint,
  parseComplaintsPayload,
} from "./client";

// _source shapes captured from the live CFPB search API.
const LIVE_NARRATIVE_SOURCE = {
  product: "Checking or savings account",
  complaint_what_happened: "The bank charged fees I did not expect on my checking account.",
  date_sent_to_company: "2025-09-02T15:15:10.000Z",
  issue: "Problem caused by your funds being low",
  sub_product: "Checking account",
  zip_code: "30301",
  tags: null,
  has_narrative: true,
  complaint_id: "15675411",
  timely: "Yes",
  company_response: "Closed with explanation",
  submitted_via: "Web",
  company: "WELLS FARGO & COMPANY",
  date_received: "2025-09-02T15:15:08.000Z",
  state: "GA",
  company_public_response: null,
  sub_issue: "Overdrafts and overdraft fees",
};

const LIVE_BARE_SOURCE = {
  product: "Credit reporting or other personal consumer reports",
  complaint_what_happened: "",
  date_sent_to_company: "2024-09-03T22:42:56.000Z",
  issue: "Improper use of your report",
  sub_product: "Credit reporting",
  zip_code: "33060",
  tags: null,
  has_narrative: false,
  complaint_id: "9999997",
  timely: "Yes",
  company_response: "Closed with non-monetary relief",
  submitted_via: "Web",
  company: "TRANSUNION INTERMEDIATE HOLDINGS, INC.",
  date_received: "2024-09-03T22:42:53.000Z",
  state: "FL",
  company_public_response:
    "Company has responded to the consumer and the CFPB and chooses not to provide a public response",
  sub_issue: "Reporting company used your report improperly",
};

describe("parseComplaint", () => {
  test("parses a live narrative row", () => {
    expect(parseComplaint(LIVE_NARRATIVE_SOURCE)).toMatchObject({
      id: "15675411",
      product: "Checking or savings account",
      subProduct: "Checking account",
      issue: "Problem caused by your funds being low",
      subIssue: "Overdrafts and overdraft fees",
      company: "WELLS FARGO & COMPANY",
      state: "GA",
      companyResponse: "Closed with explanation",
      timely: "Yes",
      submittedVia: "Web",
      hasNarrative: true,
      narrative: "The bank charged fees I did not expect on my checking account.",
    });
  });

  test("parses the received timestamp into a Date", () => {
    expect(parseComplaint(LIVE_NARRATIVE_SOURCE)?.dateReceived).toEqual(
      new Date("2025-09-02T15:15:08.000Z"),
    );
  });

  test("keeps rows without a narrative instead of dropping them", () => {
    const complaint = parseComplaint(LIVE_BARE_SOURCE)!;
    expect(complaint.hasNarrative).toBe(false);
    expect(complaint.narrative).toBe("");
    expect(complaint.id).toBe("9999997");
  });

  test("falls back to placeholders on sparse rows but keeps the id", () => {
    expect(parseComplaint({ complaint_id: "123" })).toMatchObject({
      id: "123",
      product: "—",
      issue: "—",
      company: "—",
    });
  });

  test("drops rows without an identity and tolerates junk", () => {
    expect(parseComplaint({ product: "Mortgage" })).toBeNull();
    expect(parseComplaint({ complaint_id: "  " })).toBeNull();
    expect(parseComplaint(null)).toBeNull();
    expect(parseComplaint("15675411")).toBeNull();
    expect(parseComplaint({ complaint_id: "123", date_received: "not-a-date" })?.dateReceived)
      .toEqual(new Date(0));
  });
});

describe("parseComplaintsPayload", () => {
  function payload(rows: unknown[]) {
    return {
      hits: {
        total: { value: rows.length, relation: "eq" },
        hits: rows.map((source, index) => ({ _id: String(index), _source: source })),
      },
    };
  }

  test("unwraps _source hits and skips unusable rows", () => {
    const complaints = parseComplaintsPayload(
      payload([LIVE_NARRATIVE_SOURCE, { product: "Mortgage" }, null, LIVE_BARE_SOURCE]),
    );
    expect(complaints.map((complaint) => complaint.id)).toEqual(["15675411", "9999997"]);
  });

  test("collapses a complaint the payload repeats verbatim", () => {
    expect(parseComplaintsPayload(payload([LIVE_NARRATIVE_SOURCE, { ...LIVE_NARRATIVE_SOURCE }])))
      .toHaveLength(1);
  });

  test("respects the display cap", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      ...LIVE_NARRATIVE_SOURCE,
      complaint_id: `id-${index}`,
    }));
    expect(parseComplaintsPayload(payload(rows), 10)).toHaveLength(10);
  });

  test("returns nothing for a body without hits", () => {
    expect(parseComplaintsPayload({ error: "boom" })).toEqual([]);
    expect(parseComplaintsPayload(null)).toEqual([]);
    expect(parseComplaintsPayload("<html>")).toEqual([]);
  });
});

describe("complaintTotal", () => {
  test("reads hits.total.value", () => {
    expect(complaintTotal({ hits: { total: { value: 17_631_301, relation: "eq" } } }))
      .toBe(17_631_301);
  });

  test("is zero when the total is missing or malformed", () => {
    expect(complaintTotal({ hits: {} })).toBe(0);
    expect(complaintTotal({ hits: { total: { value: "lots" } } })).toBe(0);
    expect(complaintTotal(null)).toBe(0);
  });
});

describe("buildComplaintsUrl", () => {
  test("sorts newest first with a bounded page", () => {
    const url = buildComplaintsUrl({});
    expect(url).toContain("sort_by=date_received");
    expect(url).toContain("sort_order=desc");
    expect(url).toContain("size=25");
  });

  test("sends search, product, and company filters server-side", () => {
    const url = buildComplaintsUrl({
      searchTerm: "overdraft",
      product: "Checking or savings account",
      company: "WELLS FARGO & COMPANY",
      size: 10,
    });
    expect(url).toContain("search_term=overdraft");
    expect(url).toContain("product=Checking+or+savings+account");
    expect(url).toContain("company=WELLS+FARGO+%26+COMPANY");
    expect(url).toContain("size=10");
  });

  test("omits blank filters instead of sending empty params", () => {
    const url = buildComplaintsUrl({ searchTerm: "  ", product: "", company: " " });
    expect(url).not.toContain("search_term=");
    expect(url).not.toContain("product=");
    expect(url).not.toContain("company=");
  });
});
