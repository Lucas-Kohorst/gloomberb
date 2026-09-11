import { describe, expect, test } from "bun:test";
import {
  buildFailuresFilter,
  buildFailuresUrl,
  buildInstitutionsFilter,
  buildInstitutionsUrl,
  parseBankRecord,
  parseFailureRecord,
  parseFailuresPayload,
  parseInstitutionsPayload,
} from "./client";

// Live-shaped rows captured from the BankFind API (banks.data.fdic.gov/api).
const LIVE_BANK_ROW = {
  data: {
    CERT: 10781,
    NAME: "Scott Valley Bank",
    CITY: "Yreka",
    STALP: "CA",
    STNAME: "California",
    BKCLASS: "NM",
    ACTIVE: 1,
    ASSET: 123456,
    DEP: 100000,
    WEBADDR: "www.scottvalleybank.com",
  },
  score: 0,
};

const LIVE_INACTIVE_ROW = {
  data: {
    CERT: 10,
    NAME: "Northeast Bank of Sanford",
    CITY: "Sanford",
    STALP: "ME",
    STNAME: "Maine",
    BKCLASS: "SM",
    ACTIVE: 0,
    ASSET: 0,
    DEP: 0,
    WEBADDR: "",
  },
  score: 1,
};

const LIVE_FAILURE_ROW = {
  data: {
    ID: "42",
    NAME: "WASHINGTON MUTUAL BANK",
    CITY: "HENDERSON",
    PSTALP: "NV",
    FAILDATE: "9/25/2008",
    FAILYR: "2008",
    RESTYPE: "FAILURE",
    CERT: 32633,
  },
  score: 1,
};

const LIVE_ASSISTANCE_ROW = {
  data: {
    ID: "7",
    NAME: "CENTRAL S&LA",
    CITY: "LOS ANGELES",
    PSTALP: "CA",
    FAILDATE: "5/31/1985",
    FAILYR: "1985",
    RESTYPE: "ASSISTANCE",
    CERT: null,
  },
  score: 1,
};

describe("parseBankRecord", () => {
  test("parses a live institutions row", () => {
    expect(parseBankRecord(LIVE_BANK_ROW)).toMatchObject({
      cert: 10781,
      name: "Scott Valley Bank",
      city: "Yreka",
      state: "CA",
      bankClass: "NM",
      active: true,
      assets: 123456,
      deposits: 100000,
    });
  });

  test("marks inactive banks and tolerates blank fields", () => {
    expect(parseBankRecord(LIVE_INACTIVE_ROW)).toMatchObject({
      cert: 10,
      active: false,
      webAddress: "",
    });
  });

  test("drops rows without identity fields and tolerates junk", () => {
    expect(parseBankRecord({ data: { CITY: "Yreka" } })).toBeNull();
    expect(parseBankRecord({ data: { NAME: "No Cert" } })).toBeNull();
    expect(parseBankRecord(null)).toBeNull();
    expect(parseBankRecord("bank")).toBeNull();
  });
});

describe("parseFailureRecord", () => {
  test("parses a live failure row", () => {
    expect(parseFailureRecord(LIVE_FAILURE_ROW)).toMatchObject({
      id: "42",
      name: "WASHINGTON MUTUAL BANK",
      cert: 32633,
      state: "NV",
      failYear: "2008",
      actionType: "FAILURE",
    });
    expect(parseFailureRecord(LIVE_FAILURE_ROW)?.failDate?.getFullYear()).toBe(2008);
  });

  test("keeps assistance records with a null CERT", () => {
    expect(parseFailureRecord(LIVE_ASSISTANCE_ROW)).toMatchObject({
      actionType: "ASSISTANCE",
      cert: null,
    });
  });

  test("drops rows without a name and tolerates junk", () => {
    expect(parseFailureRecord({ data: { FAILDATE: "1/1/2020" } })).toBeNull();
    expect(parseFailureRecord(null)).toBeNull();
  });
});

describe("payload parsers", () => {
  test("skip unusable rows instead of failing the whole payload", () => {
    const banks = parseInstitutionsPayload({
      data: [LIVE_BANK_ROW, { data: {} }, null, LIVE_INACTIVE_ROW],
    });
    expect(banks.map((bank) => bank.cert)).toEqual([10781, 10]);
  });

  test("collapse verbatim repeats and cap runaway payloads", () => {
    expect(parseFailuresPayload({ data: [LIVE_FAILURE_ROW, { ...LIVE_FAILURE_ROW }] })).toHaveLength(1);
    expect(parseInstitutionsPayload({ error: "boom" })).toEqual([]);
    expect(parseFailuresPayload(null)).toEqual([]);
  });
});

describe("filter builders", () => {
  test("institutions: digits hit CERT, states hit STALP, names get quoted or wildcarded", () => {
    expect(buildInstitutionsFilter("10781")).toBe("CERT:10781");
    expect(buildInstitutionsFilter("ca")).toBe("STALP:CA");
    expect(buildInstitutionsFilter("First Bank")).toBe('NAME:"First Bank"');
    expect(buildInstitutionsFilter("First")).toBe("NAME:First*");
  });

  test("failures: years hit FAILYR, states hit PSTALP", () => {
    expect(buildFailuresFilter("2023")).toBe("FAILYR:2023");
    expect(buildFailuresFilter("32633")).toBe("CERT:32633");
    expect(buildFailuresFilter("ca")).toBe("PSTALP:CA");
    expect(buildFailuresFilter("Republic")).toBe("NAME:Republic*");
  });

  test("request urls carry fields, limit, and newest-first failure sort", () => {
    const institutions = buildInstitutionsUrl("First Bank");
    expect(institutions).toContain("/institutions?");
    expect(institutions).toContain("fields=NAME");
    expect(decodeURIComponent(institutions.replace(/\+/g, " "))).toContain('filters=NAME:"First Bank"');
    const failures = buildFailuresUrl("");
    expect(failures).toContain("/failures?");
    expect(failures).toContain("sort_by=FAILDATE");
    expect(failures).toContain("sort_order=DESC");
    expect(failures).not.toContain("filters=");
    expect(decodeURIComponent(buildFailuresUrl("2023").replace(/\+/g, " "))).toContain("filters=FAILYR:2023");
  });
});
