import { describe, expect, test } from "bun:test";
import type { CftcFiling } from "./types";
import {
  CFTC_CHART_OTHER_ORG,
  parseCftcTemplateArg,
  rollupCftcFilingsByOrgMonth,
} from "./filings-rollup";

function filing(org: string, day: string, feed: CftcFiling["feed"] = "dcm_products"): CftcFiling {
  return {
    id: Number(`${org.length}${day.replace(/-/g, "")}`),
    title: `${org} product`,
    feed,
    orgCode: org,
    status: "Certified",
    statusDate: new Date(`${day}T00:00:00Z`),
    docCount: 1,
  };
}

describe("parseCftcTemplateArg", () => {
  test("treats chart as a view seed and keeps a trailing search", () => {
    expect(parseCftcTemplateArg("chart")).toEqual({ view: "chart", query: "" });
    expect(parseCftcTemplateArg("chart CME")).toEqual({ view: "chart", query: "CME" });
    expect(parseCftcTemplateArg("CME")).toEqual({ view: "list", query: "CME" });
  });
});

describe("rollupCftcFilingsByOrgMonth", () => {
  test("stacks org counts by month and folds the tail into Other", () => {
    const filings = [
      filing("KEX", "2026-08-01"),
      filing("KEX", "2026-08-02"),
      filing("NODAL", "2026-08-03"),
      filing("KEX", "2026-07-01"),
      filing("ZZZ", "2026-08-04"),
    ];
    const chart = rollupCftcFilingsByOrgMonth(filings, { topOrgs: 2 });
    expect(chart.months).toEqual(["2026-07", "2026-08"]);
    expect(chart.orgs).toEqual(["KEX", "NODAL", CFTC_CHART_OTHER_ORG]);
    expect(chart.counts.KEX).toEqual([1, 2]);
    expect(chart.counts.NODAL).toEqual([0, 1]);
    expect(chart.counts[CFTC_CHART_OTHER_ORG]).toEqual([0, 1]);
    expect(chart.totals).toEqual([1, 4]);
  });
});
