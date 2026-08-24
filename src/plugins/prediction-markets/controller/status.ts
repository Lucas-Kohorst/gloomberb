import type {
  PredictionMarketSummary,
  PredictionVenue,
} from "../types";

export interface PredictionCatalogSource {
  venue: PredictionVenue;
  cacheKey: string;
  error: string | null;
  markets: PredictionMarketSummary[];
}

export interface PredictionCatalogStatus {
  tone: "warning" | "danger";
  message: string;
}

/**
 * Transport-level failures across every runtime we ship on. The first group is
 * Bun/Node (desktop, tests); the second is browser wording, which the hosted
 * client produces and which shares no vocabulary with Bun — note that Chrome's
 * "Failed to fetch" does not match Bun's "fetch failed".
 */
const TRANSPORT_FAILURE =
  /typo in the url or port|access the url|unable to connect|could not resolve host|connection refused|socket connection|socket hang up|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network connection|connection closed|failed to fetch|load failed|networkerror when attempting to fetch|network request failed/i;

function formatPredictionVenueLabel(venue: PredictionVenue): string {
  return venue === "polymarket" ? "Polymarket" : "Kalshi";
}

function joinPredictionVenueLabels(venues: PredictionVenue[]): string {
  const labels = [...new Set(venues.map(formatPredictionVenueLabel))];
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(" and ")} and ${labels.at(-1)}`;
}

export function formatPredictionLoadError(
  venue: PredictionVenue,
  subject: "markets" | "market detail",
  error: unknown,
): string {
  const venueLabel = formatPredictionVenueLabel(venue);
  const fallback = `Could not load ${venueLabel} ${subject}.`;
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();
  if (message.length === 0) {
    return fallback;
  }

  const requestFailureMatch = message.match(/Request failed \((\d+)\)/i);
  if (requestFailureMatch) {
    return `${venueLabel} ${subject} request failed (${requestFailureMatch[1]}).`;
  }

  if (/ERR_BLOCKED_BY_CLIENT|blocked by the browser/i.test(message)) {
    return `${venueLabel} ${subject} blocked by a browser extension or content blocker.`;
  }

  if (/TimeoutError|signal timed out|operation was aborted|timed out/i.test(message)) {
    return `${venueLabel} ${subject} timed out.`;
  }

  if (TRANSPORT_FAILURE.test(message)) {
    return `${venueLabel} is unavailable right now.`;
  }

  return `${fallback} ${message}`;
}

function joinPredictionSourceErrors(sources: PredictionCatalogSource[]): string {
  const messages = sources
    .map((source) => source.error?.trim())
    .filter((value): value is string => !!value);
  return [...new Set(messages)].join(" ");
}

export function getPredictionCatalogStatus(
  sources: PredictionCatalogSource[],
): PredictionCatalogStatus | null {
  const failingSources = sources.filter((source) => !!source.error);
  if (failingSources.length === 0) {
    return null;
  }

  const loadedSources = sources.filter(
    (source) => !source.error && source.markets.length > 0,
  );
  if (failingSources.length < sources.length) {
    // The reason is the whole value of this message. Collapsing a blocked
    // request, a 429 and a timeout into "unavailable right now" leaves nothing
    // to act on, and the venue label is already inside each source error.
    const reason = joinPredictionSourceErrors(failingSources)
      || `${joinPredictionVenueLabels(failingSources.map((source) => source.venue))} unavailable right now.`;
    if (loadedSources.length > 0) {
      return {
        tone: "warning",
        message: `${reason} Showing ${joinPredictionVenueLabels(
          loadedSources.map((source) => source.venue),
        )} markets.`,
      };
    }
    return { tone: "warning", message: reason };
  }

  return {
    tone: "danger",
    message: joinPredictionSourceErrors(failingSources),
  };
}
