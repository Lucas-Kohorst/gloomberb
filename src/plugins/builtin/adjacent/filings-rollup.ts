import type { CftcFeed, CftcFiling } from "./types";

export const CFTC_CHART_TOP_ORGS = 10;
export const CFTC_CHART_OTHER_ORG = "Other";

export interface CftcStackedBarChart {
  title: string;
  feed: CftcFeed;
  months: string[];
  orgs: string[];
  counts: Record<string, number[]>;
  totals: number[];
  publicWindow: boolean;
}

export function parseCftcTemplateArg(arg: string | undefined): {
  view: "list" | "chart";
  query: string;
} {
  const trimmed = (arg ?? "").trim();
  const chart = /^chart\b/i.exec(trimmed);
  if (chart) {
    return { view: "chart", query: trimmed.slice(chart[0].length).replace(/^[:\s]+/, "").trim() };
  }
  return { view: "list", query: trimmed };
}

export function filingChartMonth(filing: CftcFiling): string | null {
  const date = filing.statusDate ?? filing.receiptDate ?? filing.firstSeenAt;
  if (!date || !Number.isFinite(date.getTime()) || date.getTime() === 0) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function formatCftcChartMonth(month: string): string {
  const [year, monthNum] = month.split("-");
  if (!year || !monthNum) return month;
  const date = new Date(Date.UTC(Number(year), Number(monthNum) - 1, 1));
  if (!Number.isFinite(date.getTime())) return month;
  const label = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return Number(monthNum) === 1 || Number(monthNum) === 8 ? `${label} ${year.slice(2)}` : label;
}

export function rollupCftcFilingsByOrgMonth(
  filings: readonly CftcFiling[],
  options?: { feed?: CftcFeed; topOrgs?: number; publicWindow?: boolean },
): CftcStackedBarChart {
  const feed = options?.feed ?? "dcm_products";
  const topOrgs = options?.topOrgs ?? CFTC_CHART_TOP_ORGS;
  const monthSet = new Set<string>();
  const orgTotals = new Map<string, number>();
  const cellCounts = new Map<string, number>();

  for (const filing of filings) {
    if (options?.feed && filing.feed !== options.feed) continue;
    const month = filingChartMonth(filing);
    if (!month) continue;
    const org = (filing.orgCode || "UNK").toUpperCase();
    monthSet.add(month);
    orgTotals.set(org, (orgTotals.get(org) ?? 0) + 1);
    const key = `${month}|${org}`;
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  }

  const months = [...monthSet].sort();
  const rankedOrgs = [...orgTotals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([org]) => org);
  const featured = rankedOrgs.slice(0, topOrgs);
  const hasOther = rankedOrgs.length > featured.length;
  const orgs = hasOther ? [...featured, CFTC_CHART_OTHER_ORG] : featured;
  const featuredSet = new Set(featured);

  const counts: Record<string, number[]> = {};
  for (const org of orgs) counts[org] = months.map(() => 0);

  for (const [key, count] of cellCounts) {
    const [month, org] = key.split("|");
    if (!month || !org) continue;
    const monthIndex = months.indexOf(month);
    if (monthIndex < 0) continue;
    const bucket = featuredSet.has(org) ? org : CFTC_CHART_OTHER_ORG;
    const series = counts[bucket];
    if (!series) continue;
    series[monthIndex] = (series[monthIndex] ?? 0) + count;
  }

  const totals = months.map((_, index) =>
    orgs.reduce((sum, org) => sum + (counts[org]?.[index] ?? 0), 0),
  );

  return {
    title: "Who filed DCM products",
    feed,
    months,
    orgs,
    counts,
    totals,
    publicWindow: options?.publicWindow === true,
  };
}
