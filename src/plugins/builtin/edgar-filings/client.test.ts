import { describe, expect, test } from "bun:test";
import {
  appendFilings,
  applyLatestFilings,
  buildLatestFilingsUrl,
  formatAccepted,
  formatAcceptedDetail,
  parseLatestFilings,
} from "./client";
import type { EdgarFiling } from "./types";

const entry = (title: string, updated: string, summary: string, href: string, term: string, accession: string) => `
<entry>
<title>${title}</title>
<link rel="alternate" type="text/html" href="${href}"/>
<summary type="html">
 ${summary}
</summary>
<updated>${updated}</updated>
<category scheme="https://www.sec.gov/" label="form type" term="${term}"/>
<id>urn:tag:sec.gov,2008:accession-number=${accession}</id>
</entry>`;

const feed = (entries: string) => `<?xml version="1.0" encoding="ISO-8859-1" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Latest Filings</title>
${entries}
</feed>`;

const eightK = entry(
  "8-K - Crane NXT, Co. (0000025445) (Filer)",
  "2026-10-07T07:31:49-04:00",
  "&lt;b&gt;Filed:&lt;/b&gt; 2026-10-07 &lt;b&gt;AccNo:&lt;/b&gt; 0000025445-26-000041 &lt;b&gt;Size:&lt;/b&gt; 196 KB\n&lt;br&gt;Item 5.02: Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers: Compensatory Arrangements of Certain Officers\n&lt;br&gt;Item 9.01: Financial Statements and Exhibits",
  "https://www.sec.gov/Archives/edgar/data/25445/000002544526000041/0000025445-26-000041-index.htm",
  "8-K",
  "0000025445-26-000041",
);

const reporting = entry(
  "4 - Sullivan Gregory Jon (0001867146) (Reporting)",
  "2026-10-07T06:02:56-04:00",
  "&lt;b&gt;Filed:&lt;/b&gt; 2026-10-07 &lt;b&gt;AccNo:&lt;/b&gt; 0000812011-26-000120 &lt;b&gt;Size:&lt;/b&gt; 7 KB",
  "https://www.sec.gov/Archives/edgar/data/1867146/000081201126000120/0000812011-26-000120-index.htm",
  "4",
  "0000812011-26-000120",
);

const issuer = entry(
  "4 - VAIL RESORTS INC (0000812011) (Issuer)",
  "2026-10-07T06:02:56-04:00",
  "&lt;b&gt;Filed:&lt;/b&gt; 2026-10-07 &lt;b&gt;AccNo:&lt;/b&gt; 0000812011-26-000120 &lt;b&gt;Size:&lt;/b&gt; 7 KB",
  "https://www.sec.gov/Archives/edgar/data/812011/000081201126000119/0000812011-26-000120-index.htm",
  "4",
  "0000812011-26-000120",
);

const schedule = entry(
  "SCHEDULE 13G/A - FEDERATED HERMES, INC. (0001056288) (Filed by)",
  "2026-10-07T07:24:44-04:00",
  "&lt;b&gt;Filed:&lt;/b&gt; 2026-10-07 &lt;b&gt;AccNo:&lt;/b&gt; 0001623632-26-001552 &lt;b&gt;Size:&lt;/b&gt; 46 KB",
  "https://www.sec.gov/Archives/edgar/data/1056288/000162363226001552/0001623632-26-001552-index.htm",
  "SCHEDULE 13G/A",
  "0001623632-26-001552",
);

const row = (id: string): EdgarFiling => ({
  id,
  accessionNumber: id,
  form: "8-K",
  companyName: id,
  role: "Filer",
  cik: "0000000001",
  acceptedAt: new Date("2026-10-07T12:00:00Z"),
  filedDate: "2026-10-07",
  items: [],
  filingUrl: `https://www.sec.gov/${id}`,
});

describe("current filings feed", () => {
  test("reads one row per filer, with the 8-K items", () => {
    const page = parseLatestFilings(feed(eightK + reporting + issuer + schedule + "<entry><title>not a filing</title></entry>"), 0, 10);
    expect(page.rows.map((filing) => [filing.form, filing.companyName, filing.role])).toEqual([
      ["8-K", "Crane NXT, Co.", "Filer"],
      ["4", "Sullivan Gregory Jon", "Reporting"],
      ["4", "VAIL RESORTS INC", "Issuer"],
      ["SCHEDULE 13G/A", "FEDERATED HERMES, INC.", "Filed by"],
    ]);
    expect(page.rows[0]).toMatchObject({
      id: "0000025445-26-000041:0000025445:Filer",
      cik: "0000025445",
      filedDate: "2026-10-07",
      size: "196 KB",
      items: [
        "Item 5.02: Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers: Compensatory Arrangements of Certain Officers",
        "Item 9.01: Financial Statements and Exhibits",
      ],
      filingUrl: "https://www.sec.gov/Archives/edgar/data/25445/000002544526000041/0000025445-26-000041-index.htm",
    });
    expect(page.rows[1]?.id).not.toBe(page.rows[2]?.id);
    expect(page.rows[1]?.accessionNumber).toBe(page.rows[2]?.accessionNumber);
    expect(page).toMatchObject({ hasMore: false, nextOffset: null });
  });

  test("pages by the entries the feed returned", () => {
    const hundred = Array.from({ length: 100 }, (_, index) => entry(
      `4 - Person ${index} (${String(index).padStart(10, "0")}) (Reporting)`,
      "2026-10-07T06:00:00-04:00",
      `&lt;b&gt;Filed:&lt;/b&gt; 2026-10-07 &lt;b&gt;AccNo:&lt;/b&gt; 0000000001-26-${String(index).padStart(6, "0")} &lt;b&gt;Size:&lt;/b&gt; 4 KB`,
      `https://www.sec.gov/Archives/${index}`,
      "4",
      `0000000001-26-${String(index).padStart(6, "0")}`,
    )).join("");
    expect(parseLatestFilings(feed(hundred), 0)).toMatchObject({ hasMore: true, nextOffset: 100 });
    expect(parseLatestFilings(feed(hundred), 100)).toMatchObject({ hasMore: true, nextOffset: 200 });
    expect(() => parseLatestFilings("<html>no</html>", 0)).toThrow("Latest filings failed");
  });

  test("asks the feed for every form, or one form", () => {
    const all = new URL(buildLatestFilingsUrl({}));
    expect(all.searchParams.get("action")).toBe("getcurrent");
    expect(all.searchParams.get("owner")).toBe("include");
    expect(all.searchParams.get("output")).toBe("atom");
    expect(all.searchParams.get("count")).toBe("100");
    expect(all.searchParams.get("type")).toBeNull();
    expect(all.searchParams.get("start")).toBeNull();
    const filtered = new URL(buildLatestFilingsUrl({ form: "8-k", offset: 100 }));
    expect(filtered.searchParams.get("type")).toBe("8-K");
    expect(filtered.searchParams.get("start")).toBe("100");
  });
});

describe("filing list", () => {
  const now = new Date("2026-10-07T16:00:00Z");

  test("shows the acceptance time in Eastern Time", () => {
    expect(formatAccepted(new Date("2026-10-07T07:31:49-04:00"), now)).toBe("07:31");
    expect(formatAccepted(new Date("2026-10-06T18:02:00-04:00"), now)).toBe("10-06 18:02");
    expect(formatAcceptedDetail(new Date("2026-10-07T07:31:49-04:00"))).toBe("2026-10-07 07:31 ET");
  });

  test("keeps older pages under a new head, and starts over when the head falls off", () => {
    const older = [row("a"), row("b"), row("c")];
    const extended = applyLatestFilings(older, [row("n"), row("a")]);
    expect(extended.reset).toBe(false);
    expect(extended.rows.map((filing) => filing.id)).toEqual(["n", "a", "b", "c"]);

    const same = applyLatestFilings(extended.rows, [row("n"), row("a")]);
    expect(same.rows).toBe(extended.rows);

    const reset = applyLatestFilings(extended.rows, [row("z"), row("y")]);
    expect(reset).toEqual({ rows: [row("z"), row("y")], reset: true });

    expect(appendFilings(reset.rows, [row("y"), row("x")]).map((filing) => filing.id)).toEqual(["z", "y", "x"]);
  });
});
