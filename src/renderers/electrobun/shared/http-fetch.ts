/**
 * Runtime-agnostic HTTP fetch contract shared by the Electrobun backend, the
 * local web server, and the Cloudflare hosted worker. Keep this module free of
 * Node/Bun/DOM imports so it runs in every JavaScript runtime.
 */

export interface SharedHttpFetchRequest {
  url: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: "follow" | "error" | "manual";
    timeoutMs?: number;
  };
}

export interface SharedHttpFetchOptions {
  /** Cloudflare edge TTL for 2xx subresponses. Ignored outside Workers. */
  edgeCacheTtlSeconds?: number;
}

export interface SharedHttpFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  setCookie?: string[];
  body: string;
}

function normalizeHttpFetchHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export async function handleHttpFetch(
  payload: SharedHttpFetchRequest,
  options?: SharedHttpFetchOptions,
): Promise<SharedHttpFetchResponse> {
  if (typeof payload.url !== "string") {
    throw new Error("http.fetch requires a URL.");
  }

  const url = new URL(payload.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported http.fetch protocol: ${url.protocol}`);
  }

  const init =
    payload.init && typeof payload.init === "object" && !Array.isArray(payload.init)
      ? payload.init as Record<string, unknown>
      : {};
  const method =
    typeof init.method === "string" && init.method.trim().length > 0
      ? init.method.trim().toUpperCase()
      : "GET";
  const redirect =
    init.redirect === "manual" || init.redirect === "error" || init.redirect === "follow"
      ? init.redirect
      : undefined;
  const body =
    typeof init.body === "string" && method !== "GET" && method !== "HEAD"
      ? init.body
      : undefined;
  const timeoutMs =
    typeof init.timeoutMs === "number"
      && Number.isFinite(init.timeoutMs)
      && init.timeoutMs > 0
      && init.timeoutMs <= 120_000
      ? init.timeoutMs
      : undefined;

  const fetchInit: RequestInit & {
    cf?: {
      cacheEverything?: boolean;
      cacheTtlByStatus?: Record<string, number>;
    };
  } = {
    method,
    headers: normalizeHttpFetchHeaders(init.headers),
    body,
    redirect,
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  };
  if (options?.edgeCacheTtlSeconds != null && options.edgeCacheTtlSeconds > 0) {
    fetchInit.cf = {
      cacheEverything: true,
      cacheTtlByStatus: {
        "200-299": options.edgeCacheTtlSeconds,
        "400-599": 0,
      },
    };
  }
  const response = await fetch(url, fetchInit);
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  const setCookieHeaders = [...(response.headers.getSetCookie?.() ?? [])];
  const fallbackSetCookie = response.headers.get("set-cookie");
  if (fallbackSetCookie && setCookieHeaders.length === 0) {
    setCookieHeaders.push(fallbackSetCookie);
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    setCookie: setCookieHeaders,
    body: await response.text(),
  };
}
