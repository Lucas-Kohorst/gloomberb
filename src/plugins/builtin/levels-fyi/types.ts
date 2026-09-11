export const LEVELS_FYI_PLUGIN_ID = "levels-fyi";
export const LEVELS_FYI_CONNECTION_ID = "levels-fyi";
export const LEVELS_FYI_PANE_ID = "levels-fyi";
export const LEVELS_FYI_BASE_URL = "https://www.levels.fyi";
export const LEVELS_FYI_JOB_FAMILY = "software-engineer";
export const LEVELS_FYI_JOB_FAMILY_LABEL = "Software Engineer";

/** One level band (e.g. L4) with its median annual total compensation in USD. */
export interface LevelBand {
  /** Canonical band label, e.g. "L4". */
  level: string;
  /** All titles mapped to the band, e.g. ["L4", "SWE III"]. */
  titles: string[];
  /** Median annual total compensation in USD, or null when unreported. */
  totalCompensation: number | null;
  /** Number of salary samples behind the median, or null when unknown. */
  count: number | null;
  /** Typical years-of-experience range, or null when unreported. */
  yoeMin: number | null;
  yoeMax: number | null;
}

/** Normalized company salary page for one job family. */
export interface CompanySalaryPage {
  /** Display name, e.g. "Google". */
  company: string;
  /** URL slug, e.g. "google". */
  slug: string;
  /** Job family label, e.g. "Software Engineer". */
  jobFamily: string;
  /** Canonical page URL on levels.fyi. */
  url: string;
  /** Level bands ordered junior to senior. */
  bands: LevelBand[];
  /** Median (p50) annual total compensation across levels in USD. */
  medianTotal: number | null;
  /** Median (p50) annual base salary in USD. */
  medianBase: number | null;
  /** Total salary samples behind the page, or null when unknown. */
  sampleCount: number | null;
  /** Epoch millis when the page was fetched. */
  fetchedAt: number;
}
