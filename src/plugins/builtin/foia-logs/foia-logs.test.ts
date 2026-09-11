import { describe, expect, test } from "bun:test";
import {
  classifySignal,
  extractLogLinks,
  matchCompany,
  parseCsvRows,
  parseFoiaLogCsv,
  sortEntries,
} from "./client";

const CSV = [
  "Request ID,Requester Name,Request Description,Date of Request,Request Status,Final Disposition",
  '"FY26-001","Probes Reporter","records relating to Acme Corporation 10-K reviews","2026-07-14","Processed","Full Grant"',
  '"FY26-002","Jane Doe","all records concerning enforcement investigation of $XYZ","2026-07-15","Processed","No Records"',
].join("\n");

describe("parseCsvRows", () => {
  test("handles quoted fields, escaped quotes, and CRLF", () => {
    const rows = parseCsvRows('a,"b""x",c\r\nd,e,f\n');
    expect(rows).toEqual([["a", 'b"x', "c"], ["d", "e", "f"]]);
  });

  test("skips blank lines", () => {
    expect(parseCsvRows("a,b\n\nc,d\n")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("parseFoiaLogCsv", () => {
  test("maps aliased headers and classifies signals", () => {
    const entries = parseFoiaLogCsv(CSV, {
      sourceMonth: "July 2026",
      fromB7AFile: false,
      url: "https://www.sec.gov/log.csv",
    });
    expect(entries).toHaveLength(2);
    const first = entries[0]!;
    expect(first.requestId).toBe("FY26-001");
    expect(first.requesterName).toBe("Probes Reporter");
    expect(first.description).toContain("Acme Corporation");
    expect(first.disposition).toBe("Full Grant");
    expect(first.signal).toBe("watch");
    expect(first.id).toBe("July 2026::FY26-001");
  });
});

describe("classifySignal", () => {
  test("flags B7A-file rows as high", () => {
    const entry = {
      fromB7AFile: true,
      disposition: "",
      status: "",
      description: "anything",
    };
    expect(classifySignal(entry)).toBe("high");
  });

  test("flags in-text 7(A) citations as high", () => {
    expect(classifySignal({
      fromB7AFile: false,
      disposition: "withheld, Exemption 7(A)",
      status: "Processed",
      description: "records about Acme",
    })).toBe("high");
  });

  test("flags enforcement-seeking descriptions as medium", () => {
    expect(classifySignal({
      fromB7AFile: false,
      disposition: "No Records",
      status: "Processed",
      description: "subpoena and Wells notice records for Acme",
    })).toBe("medium");
  });

  test("leaves routine requests at watch", () => {
    expect(classifySignal({
      fromB7AFile: false,
      disposition: "Full Grant",
      status: "Processed",
      description: "press releases mentioning Acme",
    })).toBe("watch");
  });
});

describe("matchCompany", () => {
  const entry = (description: string) => ({
    description,
  });

  test("matches tickers on word boundaries only", () => {
    expect(matchCompany(entry("records re $XYZ and its auditors") as never, "XYZ").matched).toBe(true);
    expect(matchCompany(entry("deny XYZany connection") as never, "XYZ").matched).toBe(false);
    expect(matchCompany(entry("the certificate and locate files") as never, "CAT").matched).toBe(false);
  });

  test("matches full company names before loose token hits", () => {
    const exact = matchCompany(
      entry("records relating to Acme Corporation annual reports") as never,
      "Acme Corporation",
    );
    expect(exact.matched).toBe(true);
    expect(exact.reason).toContain("exact name");

    // "Corporation" is stripped as a corporate suffix, so the phrase is the
    // remaining tokens; a non-contiguous spread still matches, as tokens.
    const tokens = matchCompany(
      entry("Acme annual reports and Dynamics filings") as never,
      "Acme Dynamics",
    );
    expect(tokens.matched).toBe(true);
    expect(tokens.reason).toContain("acme+dynamics");
  });

  test("ignores requesters and blank descriptions", () => {
    expect(matchCompany(entry("") as never, "Acme").matched).toBe(false);
    expect(matchCompany(entry("nothing here") as never, "").matched).toBe(false);
  });
});

describe("sortEntries", () => {
  test("orders high signal before newest-first", () => {
    const base = {
      requesterName: "",
      requesterOrganization: "",
      feeCategory: "",
      status: "",
      fromB7AFile: false,
      url: "",
      matchReason: "",
    };
    const watchOld = {
      ...base,
      id: "w",
      requestId: "w",
      description: "",
      dateOfRequest: new Date("2026-01-01"),
      dateReceived: new Date("2026-01-01"),
      closedDate: new Date(0),
      signal: "watch" as const,
      sourceMonth: "m",
    };
    const highNew = {
      ...watchOld,
      id: "h",
      requestId: "h",
      signal: "high" as const,
      dateOfRequest: new Date("2026-08-01"),
      dateReceived: new Date("2026-08-01"),
    };
    const watchNew = {
      ...watchOld,
      id: "w2",
      requestId: "w2",
      dateOfRequest: new Date("2026-09-01"),
      dateReceived: new Date("2026-09-01"),
    };
    const sorted = sortEntries([watchNew, watchOld, highNew]);
    expect(sorted.map((entry) => entry.id)).toEqual(["h", "w2", "w"]);
  });
});

describe("extractLogLinks", () => {
  test("extracts monthly CSV links and flags B7A files", () => {
    const html = `
      <a href="/files/foia-july-2026.csv">July 2026</a>
      <a href="/files/foia-july-2026-b7a.csv">July 2026, B7A Exemption</a>
      <a href="https://example.com/other.csv">Other</a>
    `;
    const links = extractLogLinks(html, "https://www.sec.gov");
    expect(links).toHaveLength(3);
    expect(links[0]).toMatchObject({
      url: "https://www.sec.gov/files/foia-july-2026.csv",
      month: "July 2026",
      fromB7AFile: false,
    });
    expect(links[1]!.fromB7AFile).toBe(true);
    expect(links[1]!.month).toContain("July 2026");
  });

  test("dedupes hrefs", () => {
    const links = extractLogLinks(
      '<a href="/a.csv">May 2026</a><a href="/a.csv">May 2026 again</a>',
      "https://www.sec.gov",
    );
    expect(links).toHaveLength(1);
  });
});
