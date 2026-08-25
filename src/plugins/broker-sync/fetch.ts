import { isHostedWebClient } from "../../shared/hosted-api";
import {
  ROBINHOOD_HOSTED_TOKEN_PATH,
  isRobinhoodTokenEndpoint,
} from "../../shared/robinhood-oauth";

type FetchLike = typeof fetch;

/** Browser token exchange is blocked by Robinhood CORS; hosted proxies that POST. */
export function createRobinhoodFetch(base: FetchLike = fetch): FetchLike {
  if (!isHostedWebClient()) return base;
  return async (input, init) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    if (!isRobinhoodTokenEndpoint(url)) return base(input as RequestInfo, init);
    return base(ROBINHOOD_HOSTED_TOKEN_PATH, {
      method: init?.method ?? "POST",
      body: init?.body,
      headers: init?.headers,
      credentials: "include",
      signal: init?.signal,
    });
  };
}
