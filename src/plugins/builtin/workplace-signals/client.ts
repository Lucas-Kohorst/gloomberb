import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  HN_ALGOLIA_API_BASE_URL,
  HN_ITEM_URL,
  WORKPLACE_SIGNALS_CONNECTION_ID,
  WORKPLACE_GENERAL_THEME,
  WORKPLACE_THEMES,
  type WorkplaceSignal,
  type WorkplaceSignalPage,
  type WorkplaceSort,
  type WorkplaceThemeId,
  type WorkplaceTrendBucket,
} from "./types";

const DEFAULT_LIMIT = 30;
const HITS_PER_PAGE = 50;
const TIMEOUT_MS = 15_000;

const workplaceFetch = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 1,
  timeoutMs: TIMEOUT_MS,
  backoffBaseMs: 1000,
  dedupeGetRequests: true,
  defaultHeaders: { Accept: "application/json", "User-Agent": "gloomberb-workplace-signals" },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

// ---------------------------------------------------------------------------
// Theme taxonomy: a story joins a theme when its title or text hits one of the
// theme's keywords. Keyword lists are lowercase; matching is word-ish (the
// keyword may embed punctuation like "work-life" or quotes like "let go").
// ---------------------------------------------------------------------------

const THEME_KEYWORDS: Record<WorkplaceThemeId, string[]> = {
  layoffs: ["layoff", "layoffs", "fired", "firing", "let go", "staff cuts", "restructuring", "downsizing", "rift with", "rif"],
  compensation: ["salary", "salaries", "compensation", "pay cut", "equity", "rsu", "stock options", "negotiate", "negotiation", "total comp"],
  culture: ["culture", "toxic", "burnout", "morale", "hr ", "human resources", "diversity", "office politics"],
  management: ["manager", "managers", "management", "ceo", "executive", "leadership", "micromanag", "board "],
  "work-life": ["work-life", "work life", "overtime", "overwork", "long hours", "balance", "crunch", "weekends", "pto", "vacation"],
  hiring: ["hiring", "hired", "interview", "interviews", "job market", "hiring freeze", "recruiter", "job hunt", "unemployment", "offer letter"],
  remote: ["remote work", "remote-first", "wfh", "work from home", "return to office", "rto", "hybrid work", "distributed team"],
};

const POSITIVE_WORDS = [
  "great", "excellent", "love", "loved", "amazing", "good", "helpful",
  "transparent", "supportive", "flexible", "generous", "thriving", "win", "wins",
];

const NEGATIVE_WORDS = [
  "toxic", "awful", "worst", "layoff", "layoffs", "fired", "scam", "hostile",
  "burnout", "fear", "lawsuit", "mismanagement", "churn", "decline", "dysfunctional",
  "retaliat", "harass",
];

export function classifyThemes(title: string, text: string): WorkplaceThemeId[] {
  const haystack = ` ${`${title} ${text}`.toLowerCase()} `;
  const themes: WorkplaceThemeId[] = [];
  for (const theme of WORKPLACE_THEMES) {
    if (THEME_KEYWORDS[theme.id].some((keyword) => haystack.includes(keyword))) {
      themes.push(theme.id);
    }
  }
  return themes.length > 0 ? themes : [WORKPLACE_GENERAL_THEME.id];
}

export function scoreSentiment(title: string, text: string): number {
  const haystack = `${title} ${text}`.toLowerCase();
  let score = 0;
  for (const word of POSITIVE_WORDS) {
    if (haystack.includes(word)) score += 1;
  }
  for (const word of NEGATIVE_WORDS) {
    if (haystack.includes(word)) score -= 1;
  }
  return score;
}

function parseDate(value: unknown): Date {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/** Algolia hit → WorkplaceSignal. Pure — unit tests feed inline hits. */
export function parseSignal(hit: Record<string, unknown>): WorkplaceSignal | null {
  const id = String(hit.objectID ?? "").trim();
  if (!id) return null;
  const title = String(hit.title ?? hit.story_title ?? "").trim();
  const text = String(hit.story_text ?? hit.comment_text ?? "").trim();
  if (!title && !text) return null;
  return {
    id,
    title: title || text.slice(0, 100),
    author: String(hit.author ?? ""),
    url: /^https?:\/\//i.test(String(hit.url ?? "")) ? String(hit.url) : null,
    points: Number(hit.points ?? 0) || 0,
    commentCount: Number(hit.num_comments ?? 0) || 0,
    createdAt: parseDate(hit.created_at),
    text,
    themes: classifyThemes(title, text),
    sentiment: scoreSentiment(title, text),
  };
}

export function parseSignalsPayload(payload: unknown): WorkplaceSignalPage {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rows = Array.isArray(record.hits) ? record.hits : [];
  const signals: WorkplaceSignal[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const signal = parseSignal(row as Record<string, unknown>);
    if (signal) signals.push(signal);
  }
  return { signals, total: Number(record.nbHits ?? 0) || signals.length };
}

export function buildSearchUrl(query: string, sort: WorkplaceSort, hitsPerPage = HITS_PER_PAGE): string {
  const url = new URL(`${HN_ALGOLIA_API_BASE_URL}/search`);
  if (sort === "recent") url.pathname = `${HN_ALGOLIA_API_BASE_URL}/search_by_date`;
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", String(Math.max(1, Math.min(hitsPerPage, 100))));
  return url.toString();
}

/** HN discussion URL for a story — always exists, unlike the linked article. */
export function hnDiscussionUrl(signal: Pick<WorkplaceSignal, "id">): string {
  return `${HN_ITEM_URL}?id=${encodeURIComponent(signal.id)}`;
}

/** Monthly trend buckets, oldest first. Pure — covered by unit tests. */
export function buildTrend(signals: WorkplaceSignal[]): WorkplaceTrendBucket[] {
  const buckets = new Map<string, { count: number; points: number; sentiment: number }>();
  for (const signal of signals) {
    if (signal.createdAt.getTime() === 0) continue;
    const month = signal.createdAt.toISOString().slice(0, 7);
    const bucket = buckets.get(month) ?? { count: 0, points: 0, sentiment: 0 };
    bucket.count += 1;
    bucket.points += signal.points;
    bucket.sentiment += signal.sentiment;
    buckets.set(month, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({
      month,
      count: bucket.count,
      avgPoints: Math.round(bucket.points / bucket.count),
      avgSentiment: Math.round((bucket.sentiment / bucket.count) * 10) / 10,
    }));
}

export interface ListSignalsOptions {
  employer: string;
  sort?: WorkplaceSort;
  limit?: number;
  signal?: AbortSignal;
}

export class WorkplaceSignalsClient {
  async listSignals(options: ListSignalsOptions): Promise<WorkplaceSignalPage> {
    const { employer, sort = "top", limit = DEFAULT_LIMIT, signal } = options;
    const query = employer.trim();
    if (!query) return { signals: [], total: 0 };
    return withConnectionRequest(WORKPLACE_SIGNALS_CONNECTION_ID, "search", async () => {
      const response = await workplaceFetch.fetch(buildSearchUrl(query, sort), {
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        throw new Error(`HN search failed (${response.status})`);
      }
      const payload: unknown = await response.json();
      const page = parseSignalsPayload(payload);
      return { ...page, signals: page.signals.slice(0, limit) };
    });
  }
}
