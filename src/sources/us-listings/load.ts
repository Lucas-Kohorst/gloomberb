import { parseNasdaqListedFile, parseOtherListedFile, parseSecCompanyTickersExchange, mergeUsListings, universeToPrint } from "./parse";
import type { UsListingsUniverse, UsListingsUniversePrint } from "./types";
import {
  NASDAQ_LISTED_URL,
  OTHER_LISTED_URL,
  SEC_COMPANY_TICKERS_EXCHANGE_URL,
  US_LISTINGS_USER_AGENT,
} from "./types";

async function fetchText(fetchImpl: typeof fetch, url: string): Promise<string> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "text/plain, */*",
      "User-Agent": US_LISTINGS_USER_AGENT,
    },
  });
  if (!response.ok) {
    const error = new Error(`Listings fetch failed (${response.status}) ${url}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.text();
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": US_LISTINGS_USER_AGENT,
    },
  });
  if (!response.ok) {
    const error = new Error(`Listings fetch failed (${response.status}) ${url}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function loadUsListingsUniverse(fetchImpl: typeof fetch = fetch): Promise<UsListingsUniverse> {
  const [nasdaqText, otherText, secBody] = await Promise.all([
    fetchText(fetchImpl, NASDAQ_LISTED_URL),
    fetchText(fetchImpl, OTHER_LISTED_URL),
    fetchJson(fetchImpl, SEC_COMPANY_TICKERS_EXCHANGE_URL).catch(() => null),
  ]);
  return mergeUsListings({
    nasdaqlisted: parseNasdaqListedFile(nasdaqText),
    otherlisted: parseOtherListedFile(otherText),
    secOtc: secBody == null ? [] : parseSecCompanyTickersExchange(secBody),
  });
}

export async function loadUsListingsPrint(fetchImpl: typeof fetch = fetch): Promise<UsListingsUniversePrint> {
  return universeToPrint(await loadUsListingsUniverse(fetchImpl));
}
