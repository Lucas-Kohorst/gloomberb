import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  LEVELS_FYI_BASE_URL,
  LEVELS_FYI_CONNECTION_ID,
  LEVELS_FYI_JOB_FAMILY,
  LEVELS_FYI_JOB_FAMILY_LABEL,
  type CompanySalaryPage,
  type LevelBand,
} from "./types";

const levelsFyiFetch = createThrottledFetch({
  requestsPerMinute: 10,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 800,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "text/html",
    "User-Agent": "gloomberb-levels-fyi",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

/** "Bain & Company" -> "bain-company". Matches levels.fyi company URL slugs. */
export function slugifyCompany(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[''.]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildCompanyUrl(slug: string, jobFamilySlug = LEVELS_FYI_JOB_FAMILY): string {
  return `${LEVELS_FYI_BASE_URL}/companies/${slug}/salaries/${jobFamilySlug}`;
}

/** "$287K" / "$1.79M" / "—". Bands span ~$200K to multi-millions. */
export function formatComp(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) {
    const trimmed = (value / 1_000_000).toFixed(2).replace(/\.?0+$/, "");
    return `$${trimmed}M`;
  }
  return `$${Math.round(value / 1000)}K`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asCount(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed == null) return null;
  return Math.max(0, Math.floor(parsed));
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

// Tolerates attribute order, extra attributes, and quote style:
// <script id="__NEXT_DATA__" type="application/json">…</script>
const NEXT_DATA_RE = /<script[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
// "Google Software Engineer Salary | …" -> "Google"
const TITLE_COMPANY_RE = /^\s*(.+?)\s+software engineer salary\b/i;

function extractNextData(html: string): unknown {
  const match = NEXT_DATA_RE.exec(html);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    return null;
  }
}

function companyFromTitle(html: string): string | null {
  const title = TITLE_RE.exec(html)?.[1];
  if (!title) return null;
  return TITLE_COMPANY_RE.exec(title)?.[1]?.trim() || null;
}

function normalizeBand(raw: unknown): LevelBand | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const titles = Array.isArray(entry.titles)
    ? entry.titles.filter((title): title is string => typeof title === "string" && title.trim().length > 0)
    : [];
  const level = asString(entry.level) ?? titles[0] ?? null;
  if (!level) return null;
  const typicalYoe =
    entry.typicalYoe && typeof entry.typicalYoe === "object"
      ? (entry.typicalYoe as Record<string, unknown>)
      : null;
  return {
    level,
    titles,
    totalCompensation: asNumber(entry.totalCompensation),
    count: asCount(entry.count),
    yoeMin: typicalYoe ? asNumber(typicalYoe.min) : null,
    yoeMax: typicalYoe ? asNumber(typicalYoe.max) : null,
  };
}

export function markupChangedError(url: string): Error {
  return new Error(
    `Levels.fyi page layout changed (salary data not found). Open ${url} in a browser.`,
  );
}

export interface ParseLevelsFyiOptions {
  slug: string;
  companyQuery: string;
  url: string;
}

/**
 * Parse a levels.fyi company salary page.
 *
 * The site is JS-heavy, but a plain GET of
 * /companies/{slug}/salaries/{jobFamily} returns full server-rendered HTML
 * (~585KB) whose `__NEXT_DATA__` script embeds the page props as JSON:
 * `faqLevels` (per-level median total comp), `percentiles` (p10–p90 for
 * base/total/bonus/stock), and `median` (representative sample + count).
 * That JSON is the primary source; the `<title>` tag is only a fallback
 * for the company display name. Anything else is a markup change and
 * throws a clear error instead of rendering stale guesses.
 */
export function parseLevelsFyiHtml(html: string, options: ParseLevelsFyiOptions): CompanySalaryPage {
  const { slug, companyQuery, url } = options;
  if (!html || html.length < 1000) {
    throw new Error(
      `No Levels.fyi salary page found for "${companyQuery}". Check the company spelling.`,
    );
  }
  const nextData = extractNextData(html);
  if (!nextData || typeof nextData !== "object") {
    throw markupChangedError(url);
  }
  const pageProps = (nextData as { props?: { pageProps?: unknown } }).props?.pageProps;
  if (!pageProps || typeof pageProps !== "object") {
    throw markupChangedError(url);
  }
  const props = pageProps as Record<string, unknown>;
  if (!Array.isArray(props.faqLevels)) {
    throw markupChangedError(url);
  }

  const bands: LevelBand[] = [];
  for (const raw of props.faqLevels) {
    const band = normalizeBand(raw);
    if (band) bands.push(band);
  }

  const companyRecord =
    props.company && typeof props.company === "object"
      ? (props.company as Record<string, unknown>)
      : null;
  const levelsRecord =
    props.levels && typeof props.levels === "object"
      ? (props.levels as Record<string, unknown>)
      : null;
  const percentiles =
    props.percentiles && typeof props.percentiles === "object"
      ? (props.percentiles as Record<string, unknown>)
      : null;
  const medianRecord =
    props.median && typeof props.median === "object"
      ? (props.median as Record<string, unknown>)
      : null;

  const tc =
    percentiles?.tc && typeof percentiles.tc === "object"
      ? (percentiles.tc as Record<string, unknown>)
      : null;
  const base =
    percentiles?.base_salary && typeof percentiles.base_salary === "object"
      ? (percentiles.base_salary as Record<string, unknown>)
      : null;

  const bandSamples = bands.reduce<number | null>((sum, band) => {
    if (band.count == null) return sum;
    return (sum ?? 0) + band.count;
  }, null);

  return {
    company:
      asString(companyRecord?.name)
      ?? asString(levelsRecord?.company)
      ?? companyFromTitle(html)
      ?? companyQuery,
    slug,
    jobFamily: asString(props.jobFamily) ?? LEVELS_FYI_JOB_FAMILY_LABEL,
    url,
    bands,
    medianTotal: tc ? asNumber(tc.p50) : null,
    medianBase: base ? asNumber(base.p50) : null,
    sampleCount: asCount(medianRecord?.count) ?? bandSamples,
    fetchedAt: Date.now(),
  };
}

export class LevelsFyiClient {
  /** Fetch the software-engineer salary page for a company name or slug. */
  async fetchCompanySalaries(
    companyQuery: string,
    jobFamilySlug = LEVELS_FYI_JOB_FAMILY,
  ): Promise<CompanySalaryPage> {
    const slug = slugifyCompany(companyQuery);
    if (!slug) {
      throw new Error("Enter a company name to look up salary bands.");
    }
    const url = buildCompanyUrl(slug, jobFamilySlug);
    return withConnectionRequest(LEVELS_FYI_CONNECTION_ID, "fetchSalaries", async () => {
      const response = await levelsFyiFetch.fetch(url);
      if (!response.ok) {
        throw new Error(`Levels.fyi request failed (${response.status}).`);
      }
      const html = await response.text();
      return parseLevelsFyiHtml(html, { slug, companyQuery: companyQuery.trim(), url });
    });
  }
}
