import { isHostedWebClient } from "../../../shared/hosted-api";
import { httpFetch } from "../../../utils/http-transport";
import { CUSTOM_SERVICE_OPTION, getByokKnownService } from "./services";
import { BYOK_CUSTOM_SERVICE_ID, type ByokApiKeyEntry, type ByokAuthType } from "./types";
import { ByokOpenApiError, parseByokOpenApi } from "./openapi";

export function resolveByokService(entry: ByokApiKeyEntry) {
  if (entry.serviceId === BYOK_CUSTOM_SERVICE_ID) return CUSTOM_SERVICE_OPTION;
  return getByokKnownService(entry.serviceId) ?? CUSTOM_SERVICE_OPTION;
}

export function resolveByokRequestUrl(entry: ByokApiKeyEntry): string | null {
  const url = (entry.apiUrl || resolveByokService(entry).apiUrl || "").trim();
  return url || null;
}

export function buildByokAuthHeaders(entry: ByokApiKeyEntry): Record<string, string> {
  const service = resolveByokService(entry);
  return authHeaders(entry.openApiAuthType ?? service.authType, entry.openApiAuthKey ?? service.authKey, entry.apiKey);
}

function authHeaders(authType: ByokAuthType, authKey: string | undefined, apiKey: string): Record<string, string> {
  if (authType === "bearer") return { Authorization: `Bearer ${apiKey}` };
  if (authType === "header" && authKey) return { [authKey]: apiKey };
  if (authType === "user-agent" && authKey) return { [authKey]: apiKey };
  if (authType === "query") return {};
  return {};
}

export function applyByokQueryAuth(url: string, entry: ByokApiKeyEntry): string {
  const service = resolveByokService(entry);
  const authType = entry.openApiAuthType ?? service.authType;
  const authKey = entry.openApiAuthKey ?? service.authKey;
  if (authType !== "query" || !authKey) return url;
  const next = new URL(url);
  next.searchParams.set(authKey, entry.apiKey);
  return next.toString();
}

export type ByokErrorType = "cors" | "dns" | "timeout" | "connection-refused" | "ssl" | "auth" | "bad-url" | "network" | "http-error";

export class ByokRequestError extends Error {
  constructor(
    message: string,
    public readonly errorType: ByokErrorType,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ByokRequestError";
  }
}

export interface ByokRequestResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
}

export async function fetchByokSpec(entry: ByokApiKeyEntry): Promise<{ body: string; url: string }> {
  const specUrl = entry.openApiSpecUrl?.trim();
  if (!specUrl) throw new ByokOpenApiError("No OpenAPI spec URL configured.", "parse");
  const result = await fetchByokUrl(specUrl, {
    Accept: "application/json, text/plain, */*",
  });
  if (!result.ok) throw new ByokOpenApiError(`The OpenAPI spec URL could not be reached (${result.status}).`, "servers");
  return { body: result.body, url: specUrl };
}

/**
 * Fetches a BYOK custom endpoint through the Cloudflare worker proxy when on
 * the hosted web client, avoiding CORS restrictions. Falls back to direct
 * `httpFetch` (which uses the Electrobun backend on desktop) otherwise.
 */
export async function fetchByokEndpoint(entry: ByokApiKeyEntry): Promise<ByokRequestResult> {
  let parsedSpec: ReturnType<typeof parseByokOpenApi> | undefined;
  if (entry.openApiSpecBody || entry.openApiSpecUrl) {
    parsedSpec = entry.openApiSpecBody
      ? parseByokOpenApi(entry.openApiSpecBody, entry.openApiSpecUrl)
      : await fetchByokSpec(entry).then(({ body, url }) => parseByokOpenApi(body, url));
  }
  const rawUrl = resolveByokRequestUrl(entry) ?? parsedSpec?.baseUrl;
  if (!rawUrl) throw new ByokRequestError("No API URL configured for this key.", "bad-url");

  let targetUrl = rawUrl;
  if (parsedSpec) targetUrl = parsedSpec.probe.probeUrl!;
  const effectiveEntry = parsedSpec
    ? { ...entry, openApiAuthType: parsedSpec.authType, openApiAuthKey: parsedSpec.authKey }
    : entry;
  const url = applyByokQueryAuth(targetUrl, effectiveEntry);
  const headers = {
    Accept: "application/json, text/csv, text/plain, */*",
    ...buildByokAuthHeaders(effectiveEntry),
  };

  return fetchByokUrl(url, headers);
}

export async function fetchByokViaProxy(
  url: string,
  headers: Record<string, string>,
): Promise<ByokRequestResult> {
  let response: Response;
  try {
    response = await fetch("/api/byok/proxy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, headers, method: "GET" }),
    });
  } catch {
    throw new ByokRequestError(
      "Could not reach the proxy server. Check your network connection and try again.",
      "network",
    );
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null) as { error?: string } | null;
    throw new ByokRequestError(
      errorBody?.error ?? `Proxy request failed (${response.status}).`,
      "network",
    );
  }

  const result = await response.json().catch(() => null) as {
    ok?: boolean;
    status?: number;
    statusText?: string;
    contentType?: string;
    body?: string;
    error?: string;
    errorType?: string;
  } | null;

  if (!result) {
    throw new ByokRequestError("The proxy returned an unexpected response.", "network");
  }

  if (result.error && !result.ok && result.status == null) {
    // The proxy classified a network-level failure before reaching the target.
    const errorType = (result.errorType ?? "network") as ByokErrorType;
    const humanMessage = humanizeByokError(result.error, errorType);
    throw new ByokRequestError(humanMessage, errorType);
  }

  return {
    ok: result.ok ?? false,
    status: result.status ?? 0,
    contentType: result.contentType ?? "",
    body: result.body ?? "",
  };
}

async function fetchByokUrl(url: string, headers: Record<string, string>): Promise<ByokRequestResult> {
  if (isHostedWebClient()) return fetchByokViaProxy(url, headers);
  const response = await httpFetch(url, { method: "GET", headers });
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

function humanizeByokError(message: string, errorType: ByokErrorType): string {
  switch (errorType) {
    case "timeout":
      return `Request timed out. The API did not respond within 10 seconds.`;
    case "dns":
      return `Could not resolve the API hostname. Check that the URL is correct.`;
    case "connection-refused":
      return `Connection refused. The API server may be down or not accepting connections.`;
    case "ssl":
      return `SSL/TLS error. The API's certificate may be invalid or self-signed.`;
    case "bad-url":
      return `Invalid URL. Check that the API URL is a well-formed http(s) address.`;
    default:
      return `Network error: ${message}`;
  }
}

export function isByokTestSuccess(entry: ByokApiKeyEntry, result: ByokRequestResult): boolean {
  if (entry.serviceId === BYOK_CUSTOM_SERVICE_ID) return result.ok;
  return result.ok || result.status === 401 || result.status === 403;
}
