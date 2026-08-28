/**
 * Severe-weather source types.
 *
 * These types model the resolution of Polymarket/Kalshi markets whose settlement
 * depends on an explicit severe-weather event — hurricane, tornado, drought,
 * wildfire — to the public agency that publishes the authoritative record.
 *
 * A market is only {@link SevereWeatherSourceStatus.Supported} when its rules
 * explicitly name a public source we have an adapter for (NHC, SPC, US Drought
 * Monitor, NIFC). When the event is severe weather but the rules name a private
 * source, an ambiguous source, or no source at all, the result is
 * {@link SevereWeatherSourceStatus.Manual} — the integrator must verify
 * settlement by hand. Markets that are not about severe weather at all are
 * {@link SevereWeatherSourceStatus.Unrelated}.
 */

/** The kind of severe-weather event a market settles on. */
export type SevereWeatherEventKind =
  | "hurricane"
  | "tornado"
  | "drought"
  | "wildfire"
  | "other";

/**
 * Whether a market's severe-weather source can be auto-resolved.
 *
 * - `supported` — rules name a public source we have an adapter for.
 * - `manual` — severe-weather event but the source is private, ambiguous, or
 *   unnamed; settlement must be verified by hand.
 * - `unrelated` — the market is not about a severe-weather event.
 */
export type SevereWeatherSourceStatus = "supported" | "manual" | "unrelated";

/** Hints extracted from a prediction-market summary. */
export interface SevereWeatherMarketHints {
  venue?: string;
  seriesTicker?: string | null;
  eventTicker?: string | null;
  marketId?: string | null;
  category?: string | null;
  title?: string | null;
  description?: string | null;
  rulesPrimary?: string | null;
  rulesSecondary?: string | null;
  resolutionSource?: string | null;
}

/** The result of resolving a market to a severe-weather source. */
export interface SevereWeatherSourceResult {
  kind: SevereWeatherEventKind;
  status: SevereWeatherSourceStatus;
  /** Human-readable source name, e.g. "NHC" or "US Drought Monitor". */
  source: string | null;
  /** Landing page for the source, e.g. https://www.nhc.noaa.gov/ */
  sourceUrl: string | null;
  /** Public data endpoint the adapter reads from, when supported. */
  dataUrl: string | null;
  /** Short description of the resolution, suitable for a detail pane. */
  description: string;
  /** Why the classifier reached this result (matched keyword or rule). */
  reason: string;
}

/** A source adapter for one severe-weather event kind. */
export interface SevereWeatherSourceAdapter {
  readonly kind: SevereWeatherEventKind;
  readonly label: string;
  /** Keywords that identify the event kind in market text. */
  readonly keywords: readonly string[];
  /**
   * Phrases in rules/resolution-source text that identify this adapter's
   * public source. When any of these appear, the market is `supported`.
   */
  readonly sourceIdentifiers: readonly string[];
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly dataUrl: string;
  /** Resolve a market's source. Returns `manual` if the event matches but the source is not named. */
  resolve(hints: SevereWeatherMarketHints): SevereWeatherSourceResult;
}
