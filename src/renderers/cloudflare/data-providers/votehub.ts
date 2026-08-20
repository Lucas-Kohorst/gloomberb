import type { KeyedDataProvider, ProviderPlan } from "./types";

const VOTEHUB_ORIGIN = "https://api.votehub.com";
const ALLOWED_PATHS = new Set(["", "polls"]);
const ALLOWED_QUERY = new Set(["poll_type", "subject"]);

/**
 * Adjacent Cloud polls print. Hosted clients call
 * `GET /api/data/votehub/polls?poll_type=&subject=`; desktop hits VoteHub
 * directly. The Worker caches the upstream JSON as-is.
 *
 * Wire fields used for analysis grouping (do not drop on the Worker):
 *   id, poll_type, pollster, subject, seat_name, start_date, end_date,
 *   sample_size, population, answers[{choice,pct}], url, sponsors,
 *   partisan, internal
 *
 * Query is poll_type + subject only. Pollster-over-time and race-across-
 * pollsters grouping happens on the cached list in the Polls pane.
 */

/** Public polls change slowly; cache aggressively on the Worker isolate. */
export const VOTEHUB_TTL_SECONDS = 900;

export const voteHubProvider: KeyedDataProvider = {
  id: "votehub",
  name: "VoteHub",
  ttlSeconds: VOTEHUB_TTL_SECONDS,
  userAgent: "gloomberb-polls",
  resolve({ keyPath, search }): ProviderPlan {
    if (!ALLOWED_PATHS.has(keyPath)) {
      return { kind: "error", status: 404, error: "Unknown VoteHub path" };
    }
    const params = new URLSearchParams();
    for (const key of ALLOWED_QUERY) {
      const value = search.get(key)?.trim();
      if (value) params.set(key, value);
    }
    const query = params.size ? `?${params.toString()}` : "";
    const url = `${VOTEHUB_ORIGIN}/polls${query}`;
    return {
      kind: "print",
      cacheKey: `votehub:${url}`,
      load: async (fetchImpl) => {
        const response = await fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "gloomberb-polls",
          },
        });
        if (!response.ok) {
          const error = new Error(`VoteHub request failed (${response.status})`) as Error & {
            status?: number;
          };
          error.status = response.status;
          throw error;
        }
        return response.json();
      },
    };
  },
};
