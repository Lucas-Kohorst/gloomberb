import { describe, expect, test } from "bun:test";
import {
  buildCompanyUrl,
  formatComp,
  parseLevelsFyiHtml,
  slugifyCompany,
} from "./client";

// Page-props shape captured from the live Google software-engineer page;
// the surrounding HTML is a minimal stand-in for the ~585KB SSR document.
function fixtureProps() {
  return {
    company: { name: "Google", slug: "google" },
    jobFamily: "Software Engineer",
    levels: { company: "Google", company_slug: "google" },
    percentiles: {
      base_salary: { p10: 150000, p25: 167000, p50: 200000, p75: 220000, p90: 250000 },
      tc: { p10: 175000, p25: 207000, p50: 298000, p75: 397800, p90: 496000 },
      locationName: "United States",
    },
    median: { totalCompensation: 290000, count: 24056 },
    faqLevels: [
      { level: "L3", titles: ["L3", "SWE II"], totalCompensation: 200661, count: 48, typicalYoe: { min: 2, max: 3 } },
      { level: "L4", titles: ["L4", "SWE III"], totalCompensation: 286617, count: 52, typicalYoe: { min: 4, max: 5 } },
      { level: "L5", titles: ["L5", "Senior SWE"], totalCompensation: 426667, count: 45, typicalYoe: null },
    ],
  };
}

function fixtureHtml(pageProps: unknown, title = "Google Software Engineer Salary | $201K-$1.79M+ | Levels.fyi"): string {
  const nextData = JSON.stringify({ props: { pageProps } });
  // Pad like a real server-rendered document so the stub-body guard holds.
  const padding = `<div>${"lorem ".repeat(300)}</div>`;
  return (
    `<!DOCTYPE html><html><head><title>${title}</title></head><body>` +
    `<script id="__NEXT_DATA__" type="application/json">${nextData}</script>` +
    `${padding}</body></html>`
  );
}

const OPTS = {
  slug: "google",
  companyQuery: "google",
  url: "https://www.levels.fyi/companies/google/salaries/software-engineer",
};

describe("slugifyCompany", () => {
  test("lowercases plain names", () => {
    expect(slugifyCompany("Google")).toBe("google");
  });

  test("strips punctuation and joins on dashes", () => {
    expect(slugifyCompany("Bain & Company")).toBe("bain-and-company");
    expect(slugifyCompany("  Meta Platforms, Inc. ")).toBe("meta-platforms-inc");
  });

  test("returns empty for blank input", () => {
    expect(slugifyCompany("   ")).toBe("");
  });
});

describe("buildCompanyUrl", () => {
  test("builds the software-engineer salary page URL", () => {
    expect(buildCompanyUrl("google")).toBe(
      "https://www.levels.fyi/companies/google/salaries/software-engineer",
    );
  });
});

describe("formatComp", () => {
  test("formats thousands and millions", () => {
    expect(formatComp(286617)).toBe("$287K");
    expect(formatComp(1786800)).toBe("$1.79M");
    expect(formatComp(null)).toBe("—");
  });
});

describe("parseLevelsFyiHtml", () => {
  test("parses level bands, medians, and sample counts", () => {
    const page = parseLevelsFyiHtml(fixtureHtml(fixtureProps()), OPTS);
    expect(page.company).toBe("Google");
    expect(page.slug).toBe("google");
    expect(page.jobFamily).toBe("Software Engineer");
    expect(page.url).toBe(OPTS.url);
    expect(page.bands).toHaveLength(3);
    expect(page.bands[0]).toMatchObject({
      level: "L3",
      totalCompensation: 200661,
      count: 48,
      yoeMin: 2,
      yoeMax: 3,
    });
    expect(page.bands[0]!.titles).toEqual(["L3", "SWE II"]);
    expect(page.bands[2]).toMatchObject({
      level: "L5",
      totalCompensation: 426667,
      yoeMin: null,
      yoeMax: null,
    });
    expect(page.medianTotal).toBe(298000);
    expect(page.medianBase).toBe(200000);
    expect(page.sampleCount).toBe(24056);
  });

  test("tolerates quote style and attribute order on the data script", () => {
    const nextData = JSON.stringify({ props: { pageProps: fixtureProps() } });
    const html =
      `<!DOCTYPE html><html><head><title>x</title><body>` +
      `<script type='application/json' id='__NEXT_DATA__'>${nextData}</script>` +
      `<p>${"pad ".repeat(400)}</p></body></html>`;
    const page = parseLevelsFyiHtml(html, OPTS);
    expect(page.bands).toHaveLength(3);
  });

  test("falls back to the title tag when the company object is missing", () => {
    const props = fixtureProps() as Record<string, unknown>;
    delete props.company;
    delete props.levels;
    const page = parseLevelsFyiHtml(fixtureHtml(props), OPTS);
    expect(page.company).toBe("Google");
  });

  test("returns empty bands instead of throwing when no levels are reported", () => {
    const props = { ...fixtureProps(), faqLevels: [] };
    const page = parseLevelsFyiHtml(fixtureHtml(props), OPTS);
    expect(page.bands).toEqual([]);
  });

  test("throws a markup-change error when the embedded data is gone", () => {
    const html =
      `<!DOCTYPE html><html><head><title>Google</title></head>` +
      `<body><div class="redesign">${"redesign ".repeat(300)}</div></body></html>`;
    expect(() => parseLevelsFyiHtml(html, OPTS)).toThrow(/layout changed/);
  });

  test("throws a markup-change error when faqLevels is missing", () => {
    const props = { ...fixtureProps() } as Record<string, unknown>;
    delete props.faqLevels;
    expect(() => parseLevelsFyiHtml(fixtureHtml(props), OPTS)).toThrow(/layout changed/);
  });

  test("throws a not-found error for empty or stub bodies", () => {
    expect(() => parseLevelsFyiHtml("", OPTS)).toThrow(/No Levels\.fyi salary page/);
    expect(() => parseLevelsFyiHtml("<html></html>", OPTS)).toThrow(/No Levels\.fyi salary page/);
  });
});
