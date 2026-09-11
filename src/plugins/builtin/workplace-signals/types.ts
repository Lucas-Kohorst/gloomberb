/**
 * Workplace Signals types.
 *
 * Glassdoor and Indeed review pages are bot-walled (HTTP 403 behind
 * interactive challenges) and offer no free API, so there is no reachable
 * Glassdoor-style rating feed for a plain server-side fetch. This plugin
 * instead mines public Hacker News discussion threads about employers via the
 * free, keyless HN Algolia API and derives Glassdoor-style diligence signals
 * from them: sentiment scores (rating proxy), complaint-theme taxonomy, and
 * theme clustering with monthly trend buckets.
 */

export const WORKPLACE_SIGNALS_PLUGIN_ID = "workplace-signals";
export const WORKPLACE_SIGNALS_CONNECTION_ID = "workplace-signals";
export const WORKPLACE_SIGNALS_PANE_ID = "workplace";
export const HN_ALGOLIA_API_BASE_URL = "https://hn.algolia.com/api/v1";
export const HN_ITEM_URL = "https://news.ycombinator.com/item";

/** Stable theme ids used for clustering workplace threads. */
export type WorkplaceThemeId =
  | "layoffs"
  | "compensation"
  | "culture"
  | "management"
  | "work-life"
  | "hiring"
  | "remote";

export interface WorkplaceTheme {
  id: WorkplaceThemeId;
  label: string;
}

export const WORKPLACE_THEMES: readonly WorkplaceTheme[] = [
  { id: "layoffs", label: "Layoffs" },
  { id: "compensation", label: "Compensation" },
  { id: "culture", label: "Culture" },
  { id: "management", label: "Management" },
  { id: "work-life", label: "Work-life" },
  { id: "hiring", label: "Hiring" },
  { id: "remote", label: "Remote & RTO" },
];

export const WORKPLACE_GENERAL_THEME: WorkplaceTheme = { id: "culture", label: "General" };

/** One HN story treated as a workplace-review signal. */
export interface WorkplaceSignal {
  /** Algolia objectID, e.g. "14793647". */
  id: string;
  title: string;
  author: string;
  /** Linked article URL when the story links out; null for text-only posts. */
  url: string | null;
  points: number;
  commentCount: number;
  createdAt: Date;
  /** story_text for Ask HN / text posts; empty for link posts. */
  text: string;
  /** Theme cluster ids, most relevant first. Never empty. */
  themes: WorkplaceThemeId[];
  /** Lexicon sentiment: positive minus negative hits over title + text. */
  sentiment: number;
}

/** A page of workplace signals. */
export interface WorkplaceSignalPage {
  signals: WorkplaceSignal[];
  /** nbHits from Algolia; 0 when absent. */
  total: number;
}

/** One month of aggregated signal activity for trend display. */
export interface WorkplaceTrendBucket {
  month: string;
  count: number;
  avgPoints: number;
  avgSentiment: number;
}

export type WorkplaceSort = "top" | "recent";
