import { loadUsListingsPrint } from "../../../sources/us-listings/load";
import {
  US_LISTINGS_PROVIDER_ID,
  US_LISTINGS_TTL_SECONDS,
  US_LISTINGS_USER_AGENT,
} from "../../../sources/us-listings/types";
import type { KeyedDataProvider, ProviderPlan } from "./types";

/**
 * Cached US listed-universe security master.
 *
 * Upstream: Nasdaq Trader nasdaqlisted.txt + otherlisted.txt (NYSE / Nasdaq /
 * ARCA / AMEX / BATS / IEX) and SEC company_tickers_exchange.json for OTC
 * symbols not already listed. Regenerated files are nightly; this provider
 * caches the merged print for {@link US_LISTINGS_TTL_SECONDS} (12h).
 *
 * GET /api/data/us-listings/universe
 */
export const usListingsProvider: KeyedDataProvider = {
  id: US_LISTINGS_PROVIDER_ID,
  name: "US listed universe",
  ttlSeconds: US_LISTINGS_TTL_SECONDS,
  userAgent: US_LISTINGS_USER_AGENT,
  resolve({ keyPath }): ProviderPlan {
    if (keyPath !== "" && keyPath !== "universe") {
      return { kind: "error", status: 404, error: "Unknown US listings path" };
    }
    return {
      kind: "print",
      cacheKey: "us-listings:universe",
      load: async (fetchImpl) => loadUsListingsPrint(fetchImpl),
    };
  },
};
