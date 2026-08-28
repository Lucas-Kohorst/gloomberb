/**
 * Severe-weather market classification.
 *
 * Identifies whether a prediction market is about a severe-weather event
 * (hurricane, tornado, drought, wildfire) from its title, rules, and
 * description text, and returns the {@link SevereWeatherEventKind}.
 *
 * Classification is intentionally conservative: daily temperature and
 * precipitation markets (handled by the existing Weather Company / NWS CLI
 * mapping) are NOT severe weather and return `null`.
 */

import type { SevereWeatherEventKind, SevereWeatherMarketHints } from "./types";

/** Keywords for each severe-weather event kind, ordered by specificity. */
const KIND_KEYWORDS: ReadonlyArray<{
  kind: SevereWeatherEventKind;
  keywords: readonly string[];
}> = [
  {
    kind: "hurricane",
    keywords: [
      "hurricane",
      "hurricanes",
      "tropical cyclone",
      "tropical storm",
      "tropical depression",
      "typhoon",
      "typhoons",
      "named storm",
      "saffir-simpson",
      "category 1",
      "category 2",
      "category 3",
      "category 4",
      "category 5",
      "cat 1",
      "cat 2",
      "cat 3",
      "cat 4",
      "cat 5",
      "landfall",
      "storm surge",
      "hurricane force wind",
      "tropical storm force wind",
      "major hurricane",
    ],
  },
  {
    kind: "tornado",
    keywords: [
      "tornado",
      "tornadoes",
      "tornado outbreak",
      "enhanced fujita",
      "ef0",
      "ef1",
      "ef2",
      "ef3",
      "ef4",
      "ef5",
      "tornado count",
      "severe thunderstorm",
      "severe weather outbreak",
    ],
  },
  {
    kind: "drought",
    keywords: [
      "drought",
      "drought monitor",
      "exceptional drought",
      "extreme drought",
      "severe drought",
      "moderate drought",
      "abnormally dry",
      "d0 drought",
      "d1 drought",
      "d2 drought",
      "d3 drought",
      "d4 drought",
    ],
  },
  {
    kind: "wildfire",
    keywords: [
      "wildfire",
      "wildfires",
      "wildland fire",
      "forest fire",
      "acreage burned",
      "acres burned",
      "fire season",
      "megafire",
      "prescribed burn",
    ],
  },
];

/**
 * Phrases that indicate a daily-weather market (temperature, precipitation,
 * snowfall) handled by the existing Weather Company / NWS CLI mapping, not a
 * severe-weather event. These are excluded to avoid false positives — e.g.
 * "Will the high temperature in Miami be above 90°F?" is not a hurricane market
 * even though Miami is a hurricane-prone city.
 */
const DAILY_WEATHER_RE =
  /\b(high temperature|low temperature|daily high|daily low|max temp|min temp|precipitation|snowfall|climatological report|cli[a-z]{2,4})\b/i;

/** Tokens that look like severe weather but are not settlement events. */
const NOISE_RE =
  /\b(weather company|weather\.com\/kalshi|climate and weather)\b/i;

function joinHints(hints: SevereWeatherMarketHints): string {
  return [
    hints.resolutionSource,
    hints.rulesPrimary,
    hints.rulesSecondary,
    hints.description,
    hints.title,
    hints.category,
  ].filter((value): value is string => !!value && value.trim().length > 0).join("\n");
}

function hasToken(text: string, token: string): boolean {
  const escaped = token.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

/**
 * Classify the severe-weather event kind from market hints.
 *
 * Returns the {@link SevereWeatherEventKind} or `null` when the market is not
 * about a severe-weather event. Daily temperature / precipitation markets are
 * excluded — they are handled by the Weather Company / NWS CLI mapping, not
 * severe-weather adapters.
 *
 * When multiple kinds match, the first matching kind in the
 * {@link KIND_KEYWORDS} order wins (hurricane > tornado > drought > wildfire),
 * which mirrors the specificity of the keyword lists.
 */
export function classifySevereWeatherKind(
  hints: SevereWeatherMarketHints,
): SevereWeatherEventKind | null {
  const text = joinHints(hints);
  if (!text.trim()) return null;
  const lower = text.toLowerCase();

  // Daily-weather markets are not severe weather.
  if (DAILY_WEATHER_RE.test(text) && !hasSevereKeyword(lower)) {
    return null;
  }
  // Suppress the "Climate and Weather" category label alone.
  if (NOISE_RE.test(text) && !hasSevereKeyword(lower)) {
    return null;
  }

  for (const entry of KIND_KEYWORDS) {
    if (entry.keywords.some((keyword) => hasToken(lower, keyword))) {
      return entry.kind;
    }
  }
  return null;
}

function hasSevereKeyword(lowerText: string): boolean {
  return KIND_KEYWORDS.some((entry) =>
    entry.keywords.some((keyword) => hasToken(lowerText, keyword)),
  );
}

/**
 * Whether the market text mentions any severe-weather keyword at all.
 * Exposed for adapters that want to short-circuit before doing source work.
 */
export function isSevereWeatherMarket(
  hints: SevereWeatherMarketHints,
): boolean {
  return classifySevereWeatherKind(hints) !== null;
}
