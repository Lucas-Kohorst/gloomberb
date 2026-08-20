import { setCloudApiFetchTransport } from "../../../api-client";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import type { DesktopHttpFetchResponse } from "../shared/protocol";
import { backendRequest } from "./backend-rpc";

const CLOUD_MARKET_HTTP_TIMEOUT_MS = 10_000;

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!headers) return normalized;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalized[key] = value;
    });
    return normalized;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      normalized[key] = value;
    }
    return normalized;
  }
  return { ...headers };
}

function createAbortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

async function serializeBody(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  return new Response(body).text();
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    throw createAbortError();
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(createAbortError());
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

async function electrobunHttpFetch(url: string, init?: RequestInit): Promise<Response> {
  if (init?.signal?.aborted) {
    throw createAbortError();
  }

  const requestPromise = requestBackendHttpFetch(url, init);

  const response = await withAbort(requestPromise, init?.signal);
  const headers = createResponseHeaders(response.headers, response.setCookie);
  const fetchResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  Object.defineProperty(fetchResponse, "headers", {
    value: headers,
    configurable: true,
  });
  return fetchResponse;
}

async function requestBackendHttpFetch(
  url: string,
  init?: RequestInit,
  timeoutMs?: number,
): Promise<DesktopHttpFetchResponse> {
  return backendRequest("http.fetch", {
    url,
    init: {
      method: init?.method,
      headers: normalizeHeaders(init?.headers),
      body: await serializeBody(init?.body),
      redirect: init?.redirect,
      timeoutMs,
    },
  });
}

function createResponseHeaders(headers: Record<string, string>, setCookie: string[] = []): Headers {
  const responseHeaders = new Headers(headers);
  if (setCookie.length === 0) return responseHeaders;

  const originalGet = responseHeaders.get.bind(responseHeaders);
  responseHeaders.get = ((name: string) => (
    name.toLowerCase() === "set-cookie" ? setCookie[0] ?? null : originalGet(name)
  )) as Headers["get"];
  (responseHeaders as Headers & { getSetCookie?: () => string[] }).getSetCookie = () => [...setCookie];
  return responseHeaders;
}

async function electrobunCloudApiFetch(url: string, init?: RequestInit): Promise<Response> {
  if (init?.signal?.aborted) {
    throw createAbortError();
  }
  const timeoutMs = new URL(url).pathname.startsWith("/market/")
    ? CLOUD_MARKET_HTTP_TIMEOUT_MS
    : undefined;
  const response = await withAbort(requestBackendHttpFetch(url, init, timeoutMs), init?.signal);

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.statusText,
    headers: createResponseHeaders(response.headers, response.setCookie),
    text: async () => response.body,
  } as Response;
}

export function installElectrobunHttpFetchTransport(): void {
  setHttpFetchTransport(electrobunHttpFetch);
}

export function installElectrobunCloudApiFetchTransport(): void {
  setCloudApiFetchTransport(electrobunCloudApiFetch);
}

export function installHostedCloudApiFetchTransport(): void {
  setCloudApiFetchTransport(async (url, init) => {
    const upstreamUrl = new URL(url);
    const headers = new Headers(init?.headers);
    headers.delete("Cookie");
    // The API client stamps Origin as https://api.gloom.sh. That is the desktop
    // Gloom Cloud host, not this SPA — the Worker CSRF check would 403 it.
    headers.delete("Origin");
    const pageOrigin = typeof window !== "undefined" ? window.location?.origin : "";
    if (pageOrigin) headers.set("Origin", pageOrigin);
    // Prefix `/cloud` onto the API client path so the Worker can attach the
    // hosted session cookie. Paths that already start with `/cloud/` (econ
    // calendar) become `/cloud/cloud/...`; the Worker maps both that and
    // `/cloud/econ/calendar` onto `https://api.gloom.sh/cloud/econ/calendar`.
    const response = await fetch(`/cloud${upstreamUrl.pathname}${upstreamUrl.search}`, {
      ...init,
      headers,
      credentials: "include",
    });
    if (response.headers.get("x-gloom-hosted-session") === "1") {
      window.__GLOOM_CLOUD_AUTHENTICATED = true;
    } else if (upstreamUrl.pathname === "/auth/sign-out" && response.ok) {
      window.__GLOOM_CLOUD_AUTHENTICATED = false;
    }
    return response;
  });
}
