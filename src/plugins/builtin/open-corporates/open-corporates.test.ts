import { describe, expect, test } from "bun:test";
import {
  buildCompanyUrl,
  buildSearchUrl,
  parseCompaniesPayload,
  parseCompany,
  parseCompanyDetailPayload,
  parseOfficer,
} from "./client";

// Shape captured from the live v0.4 companies/search response envelope.
const LIVE_COMPANY = {
  company: {
    name: "ACME LTD",
    company_number: "01234567",
    jurisdiction_code: "gb",
    company_type: "Private Limited Company",
    incorporation_date: "2001-04-18",
    current_status: "Active",
    inactive: false,
    registered_address_in_full: "1 Example Street, London",
    opencorporates_url: "https://opencorporates.com/companies/gb/01234567",
  },
};

const LIVE_SEARCH_PAYLOAD = {
  results: {
    companies: [
      LIVE_COMPANY,
      {
        company: {
          name: "ACME HOLDINGS INC",
          company_number: "123456",
          jurisdiction_code: "us_de",
          company_type: "Corporation",
          incorporation_date: "1998-11-02",
          current_status: "Inactive",
          inactive: true,
          registered_address_in_full: "Wilmington, DE",
          opencorporates_url: "https://opencorporates.com/companies/us_de/123456",
        },
      },
    ],
    total_count: 2,
    page: 1,
  },
};

describe("parseCompany", () => {
  test("parses the enveloped live shape into an identity-stable id", () => {
    const company = parseCompany(LIVE_COMPANY)!;
    expect(company).toMatchObject({
      id: "gb/01234567",
      name: "ACME LTD",
      companyNumber: "01234567",
      jurisdictionCode: "gb",
      currentStatus: "Active",
      inactive: false,
    });
    expect(company.incorporationDate.toISOString()).toContain("2001-04-18");
  });

  test("drops records without a name or identity fields", () => {
    expect(parseCompany({ company: { company_number: "1", jurisdiction_code: "gb" } })).toBeNull();
    expect(parseCompany({ company: { name: "No number", jurisdiction_code: "gb" } })).toBeNull();
    expect(parseCompany({ company: { name: "No jurisdiction", company_number: "1" } })).toBeNull();
    expect(parseCompany(null)).toBeNull();
    expect(parseCompany("ACME")).toBeNull();
  });
});

describe("parseCompaniesPayload", () => {
  test("parses the live search envelope and keeps its total", () => {
    const page = parseCompaniesPayload(LIVE_SEARCH_PAYLOAD);
    expect(page.total).toBe(2);
    expect(page.companies.map((company) => company.id)).toEqual(["gb/01234567", "us_de/123456"]);
  });

  test("skips unusable rows instead of failing the whole payload", () => {
    const page = parseCompaniesPayload({
      results: { companies: [LIVE_COMPANY, { company: { name: "" } }, null], total_count: 99 },
    });
    expect(page.companies).toHaveLength(1);
    expect(page.total).toBe(99);
  });

  test("stops at the display cap", () => {
    const payload = {
      results: {
        companies: Array.from({ length: 10 }, (_, index) => ({
          company: {
            name: `ACME ${index}`,
            company_number: String(index),
            jurisdiction_code: "gb",
          },
        })),
      },
    };
    expect(parseCompaniesPayload(payload, 3).companies).toHaveLength(3);
  });

  test("returns nothing for a body without a company list", () => {
    expect(parseCompaniesPayload({ error: "boom" })).toEqual({ companies: [], total: 0 });
    expect(parseCompaniesPayload(null)).toEqual({ companies: [], total: 0 });
    expect(parseCompaniesPayload("<html>")).toEqual({ companies: [], total: 0 });
  });
});

describe("officers", () => {
  test("parseOfficer reads the enveloped officer shape", () => {
    expect(parseOfficer({
      officer: { name: "Jane Doe", position: "director", start_date: "2010-01-01", end_date: "" },
    })).toEqual({ name: "Jane Doe", position: "director", startDate: "2010-01-01", endDate: "" });
  });

  test("parseOfficer drops nameless rows and tolerates junk", () => {
    expect(parseOfficer({ officer: { position: "director" } })).toBeNull();
    expect(parseOfficer(null)).toBeNull();
  });

  test("parseCompanyDetailPayload extracts officers from company detail", () => {
    const detail = parseCompanyDetailPayload({
      results: {
        company: {
          ...(LIVE_COMPANY.company as Record<string, unknown>),
          officers: [
            { officer: { name: "Jane Doe", position: "director" } },
            { officer: { name: "" } },
          ],
        },
      },
    })!;
    expect(detail.id).toBe("gb/01234567");
    expect(detail.officers).toEqual([
      { name: "Jane Doe", position: "director", startDate: "", endDate: "" },
    ]);
  });

  test("parseCompanyDetailPayload returns null without an identifiable company", () => {
    expect(parseCompanyDetailPayload({ results: { company: { name: "" } } })).toBeNull();
    expect(parseCompanyDetailPayload(null)).toBeNull();
  });
});

describe("url builders", () => {
  test("search url encodes the query against the v0.4 endpoint", () => {
    expect(buildSearchUrl("Acme Ltd")).toBe(
      "https://api.opencorporates.com/v0.4/companies/search?q=Acme%20Ltd",
    );
  });

  test("company url encodes jurisdiction and number", () => {
    expect(buildCompanyUrl("us_de", "123456")).toBe(
      "https://api.opencorporates.com/v0.4/companies/us_de/123456",
    );
  });
});
