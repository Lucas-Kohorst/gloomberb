import {
  apiClient,
  type CloudProxyStatementListPayload,
  type CloudProxyStatementPayload,
} from "../../../api-client";
import { ApiRequestError } from "../../../api-client/errors";
import type { PluginPersistence } from "../../../types/plugin";
import { withConnectionRequest } from "../connections/register";

/**
 * Executive compensation comes from Gloom Cloud's open proxy-statement
 * reads. A proxy is filed once a year and the extraction does not change
 * after it is verified, so a statement is kept for a long time; the list
 * of years is refreshed more often, since a new filing adds one.
 */

const LIST_KIND = "proxies";
const STATEMENT_KIND = "proxy";
const CACHE_SOURCE = "executives";
const CACHE_SCHEMA_VERSION = 1;
export const EXECUTIVES_CONNECTION_ID = "gloom-cloud-proxies";

const LIST_CACHE_POLICY = {
  staleMs: 6 * 60 * 60 * 1000,
  expireMs: 30 * 24 * 60 * 60 * 1000,
} as const;

const STATEMENT_CACHE_POLICY = {
  staleMs: 7 * 24 * 60 * 60 * 1000,
  expireMs: 365 * 24 * 60 * 60 * 1000,
} as const;

let persistence: PluginPersistence | null = null;
const activeListFetches = new Map<string, Promise<CloudProxyStatementListPayload>>();
const activeStatementFetches = new Map<string, Promise<CloudProxyStatementPayload>>();

export function attachExecutivesPersistence(value: PluginPersistence): void {
  persistence = value;
}

export function resetExecutivesPersistence(): void {
  persistence = null;
  activeListFetches.clear();
  activeStatementFetches.clear();
}

function cached<T>(kind: string, key: string, allowExpired = false) {
  return persistence?.getResource<T>(kind, key, {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    allowExpired,
  });
}

function remember<T>(
  kind: string,
  key: string,
  value: T,
  policy: { staleMs: number; expireMs: number },
) {
  persistence?.setResource(kind, key, value, {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    cachePolicy: policy,
  });
}

export function isMissingProxy(error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status === 404) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /404|not found|no proxy/i.test(message);
}

export async function loadProxyStatements(
  ticker: string,
  options?: { force?: boolean },
): Promise<CloudProxyStatementListPayload> {
  const key = ticker.toUpperCase();
  const force = options?.force ?? false;
  const hit = cached<CloudProxyStatementListPayload>(LIST_KIND, key);
  if (!force && hit && !hit.stale) return hit.value;

  const active = activeListFetches.get(key);
  if (active && !force) return active;

  const request = withConnectionRequest(EXECUTIVES_CONNECTION_ID, "proxy-statements", () =>
    apiClient.getProxyStatements(key),
  )
    .then((payload) => {
      remember(LIST_KIND, key, payload, LIST_CACHE_POLICY);
      return payload;
    })
    .catch((error: unknown) => {
      const expired = cached<CloudProxyStatementListPayload>(LIST_KIND, key, true);
      if (expired) return expired.value;
      throw error;
    })
    .finally(() => {
      if (activeListFetches.get(key) === request) activeListFetches.delete(key);
    });
  activeListFetches.set(key, request);
  return request;
}

export async function loadProxyStatement(
  ticker: string,
  year: number,
  options?: { force?: boolean },
): Promise<CloudProxyStatementPayload> {
  const key = `${ticker.toUpperCase()}:${year}`;
  const force = options?.force ?? false;
  const hit = cached<CloudProxyStatementPayload>(STATEMENT_KIND, key);
  if (!force && hit && !hit.stale) return hit.value;

  const active = activeStatementFetches.get(key);
  if (active && !force) return active;

  const request = withConnectionRequest(EXECUTIVES_CONNECTION_ID, "proxy-statement", () =>
    apiClient.getProxyStatement(ticker, year),
  )
    .then((payload) => {
      remember(STATEMENT_KIND, key, payload, STATEMENT_CACHE_POLICY);
      return payload;
    })
    .catch((error: unknown) => {
      const expired = cached<CloudProxyStatementPayload>(STATEMENT_KIND, key, true);
      if (expired) return expired.value;
      throw error;
    })
    .finally(() => {
      if (activeStatementFetches.get(key) === request) activeStatementFetches.delete(key);
    });
  activeStatementFetches.set(key, request);
  return request;
}
