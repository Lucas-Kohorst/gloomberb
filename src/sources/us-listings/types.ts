/**
 * US listed-universe security master.
 *
 * Official listings files (Nasdaq Trader symbol directory) are cached on
 * Adjacent Cloud: GET `/api/data/us-listings/universe`. Clients hydrate from
 * that print and search locally. This is not Yahoo typeahead and not the
 * user's saved `ticker.loadAll` set (hosted RPC returns []).
 *
 * TTL: Nasdaq Trader regenerates nasdaqlisted.txt / otherlisted.txt each
 * business night. The Worker isolate cache and payload `ttlSeconds` are
 * **12 hours (43_200s)**. SEC `company_tickers_exchange.json` is used only
 * for cheap OTC coverage of symbols not already in the listed files, with
 * the same TTL. Refresh is periodic; it is not a real-time tape.
 *
 * No API keys. Secrets never leave the Worker (none are required here).
 */

export const US_LISTINGS_PROVIDER_ID = "us-listings";
export const US_LISTINGS_TTL_SECONDS = 12 * 60 * 60;
export const US_LISTINGS_USER_AGENT =
  "Gloomberb (https://terminal.kohor.st; listings@kohor.st)";

export const NASDAQ_LISTED_URL =
  "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
export const OTHER_LISTED_URL =
  "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";
export const SEC_COMPANY_TICKERS_EXCHANGE_URL =
  "https://www.sec.gov/files/company_tickers_exchange.json";

export type UsListingType = "EQUITY" | "ETF" | "ETN" | "WARRANT" | "RIGHT" | "UNIT";

export interface UsListedSecurity {
  symbol: string;
  name: string;
  exchange: string;
  type: UsListingType;
  /** nasdaqlisted | otherlisted | sec-otc */
  source: "nasdaqlisted" | "otherlisted" | "sec-otc";
}

export interface UsListingsSourceMeta {
  id: "nasdaqlisted" | "otherlisted" | "sec-otc";
  url: string;
  ttlSeconds: number;
}

export interface UsListingsUniverse {
  asOf: string;
  ttlSeconds: number;
  sources: UsListingsSourceMeta[];
  securities: UsListedSecurity[];
}

/** Compact Adjacent Cloud print. Keep keys short — ~10k US names. */
export interface UsListingsUniversePrint {
  asOf: string;
  ttlSeconds: number;
  sources: UsListingsSourceMeta[];
  securities: Array<{
    s: string;
    n: string;
    e: string;
    t: UsListingType;
    src: UsListedSecurity["source"];
  }>;
}
