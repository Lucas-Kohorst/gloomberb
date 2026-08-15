import { httpFetch } from "../../../utils/http-transport";
import { CUSTOM_SERVICE_OPTION, getByokKnownService } from "./services";
import { BYOK_CUSTOM_SERVICE_ID, type ByokApiKeyEntry, type ByokAuthType } from "./types";

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
  return authHeaders(service.authType, service.authKey, entry.apiKey);
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
  if (service.authType !== "query" || !service.authKey) return url;
  const next = new URL(url);
  next.searchParams.set(service.authKey, entry.apiKey);
  return next.toString();
}

export interface ByokRequestResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
}

export async function fetchByokEndpoint(entry: ByokApiKeyEntry): Promise<ByokRequestResult> {
  const rawUrl = resolveByokRequestUrl(entry);
  if (!rawUrl) throw new Error("No API URL to request.");
  const url = applyByokQueryAuth(rawUrl, entry);
  const response = await httpFetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json, text/csv, text/plain, */*",
      ...buildByokAuthHeaders(entry),
    },
  });
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

export function isByokTestSuccess(entry: ByokApiKeyEntry, result: ByokRequestResult): boolean {
  if (entry.serviceId === BYOK_CUSTOM_SERVICE_ID) return result.ok;
  return result.ok || result.status === 401 || result.status === 403;
}
