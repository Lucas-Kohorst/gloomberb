import type {
  SharedHttpFetchRequest,
} from "../electrobun/shared/http-fetch";

export interface HostedSharedVendorEnv {
  ADJACENT_API_KEY?: string;
  ADJACENT_DEV_API_KEY?: string;
  ARTIFICIAL_ANALYSIS_API_KEY?: string;
}

function requestMethod(payload: SharedHttpFetchRequest): string {
  return (payload.init?.method ?? "GET").trim().toUpperCase();
}

function requestHeaders(payload: SharedHttpFetchRequest): Record<string, string> {
  return payload.init?.headers ?? {};
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = match?.[1]?.trim();
  return value ? value : undefined;
}

function clientSentVendorAuth(headers: Record<string, string>): boolean {
  return !!headerValue(headers, "authorization")
    || !!headerValue(headers, "x-api-key")
    || !!headerValue(headers, "x-cg-demo-api-key")
    || !!headerValue(headers, "x-cg-pro-api-key");
}

function parseUrl(payload: SharedHttpFetchRequest): URL | null {
  if (typeof payload.url !== "string") return null;
  try {
    return new URL(payload.url);
  } catch {
    return null;
  }
}

function withHeader(
  payload: SharedHttpFetchRequest,
  name: string,
  value: string,
): SharedHttpFetchRequest {
  return {
    ...payload,
    init: {
      ...payload.init,
      headers: {
        ...requestHeaders(payload),
        [name]: value,
      },
    },
  };
}

/**
 * Attach Worker-owned Adjacent / Artificial Analysis keys when the client did
 * not send one, so hosted users share a single origin fetch.
 */
export function applyHostedSharedVendorKeys(
  payload: SharedHttpFetchRequest,
  env: HostedSharedVendorEnv,
): SharedHttpFetchRequest {
  const url = parseUrl(payload);
  if (!url) return payload;
  const headers = requestHeaders(payload);
  const hostname = url.hostname;

  if (
    (hostname === "artificialanalysis.ai" || hostname.endsWith(".artificialanalysis.ai"))
    && !headerValue(headers, "x-api-key")
  ) {
    const envKey = env.ARTIFICIAL_ANALYSIS_API_KEY?.trim();
    if (envKey) return withHeader(payload, "x-api-key", envKey);
  }

  if (
    (hostname === "api.adjacent.markets" || hostname.endsWith(".adjacent.markets"))
    && hostname !== "api.dev.adjacent.markets"
    && !headerValue(headers, "authorization")
  ) {
    const envKey = env.ADJACENT_API_KEY?.trim();
    if (envKey) return withHeader(payload, "Authorization", `Bearer ${envKey}`);
  }

  if (
    hostname === "api.dev.adjacent.markets"
    && !headerValue(headers, "authorization")
  ) {
    const envKey = env.ADJACENT_DEV_API_KEY?.trim();
    if (envKey) return withHeader(payload, "Authorization", `Bearer ${envKey}`);
  }

  return payload;
}

/**
 * Hosted users share this Worker's egress IP. Public GETs for rate-limited
 * vendors are edge-cached and in-flight identical URLs are coalesced.
 *
 * Skip cache when the client sent its own vendor key — that response must not
 * be reused for other users. RSS / news hosts are intentionally absent.
 */
export function hostedPublicGetCacheTtlSeconds(payload: SharedHttpFetchRequest): number | null {
  const method = requestMethod(payload);
  if (method !== "GET" && method !== "HEAD") return null;
  const url = parseUrl(payload);
  if (!url) return null;
  const hostname = url.hostname;
  const pathname = url.pathname;
  const clientAuth = clientSentVendorAuth(requestHeaders(payload));

  if (hostname === "api.votehub.com" || hostname.endsWith(".votehub.com")) return 300;
  if (hostname === "api.adjacent.markets" || hostname.endsWith(".adjacent.markets")) {
    return clientAuth ? null : 60;
  }
  if (hostname === "api.dev.adjacent.markets") {
    return clientAuth ? null : 60;
  }
  if (hostname === "artificialanalysis.ai" || hostname.endsWith(".artificialanalysis.ai")) {
    return clientAuth ? null : 900;
  }
  if (hostname === "weather.com" || hostname.endsWith(".weather.com")) {
    if (pathname.startsWith("/kalshi/api/")) return 60;
    return null;
  }

  if (hostname === "kalshi.com" || hostname.endsWith(".kalshi.com")) return 60;
  if (hostname === "query1.finance.yahoo.com" || hostname === "query2.finance.yahoo.com") {
    if (pathname.includes("/getcrumb")) return null;
    return 60;
  }
  if (hostname === "api.coingecko.com" || hostname === "pro-api.coingecko.com") {
    return clientAuth ? null : 30;
  }
  if (hostname === "stockanalysis.com" || hostname.endsWith(".stockanalysis.com")) return 120;
  if (hostname === "www.nasdaqtrader.com" || hostname === "nasdaqtrader.com") return 60;
  if (hostname === "llm-stats.com" || hostname.endsWith(".llm-stats.com")) {
    return clientAuth ? null : 900;
  }
  if (hostname === "ourworldindata.org" || hostname.endsWith(".ourworldindata.org")) {
    return 6 * 60 * 60;
  }
  return null;
}
