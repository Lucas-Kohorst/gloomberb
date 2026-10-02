import { ApiRequestError } from "../../../api-client/errors";
import {
  getCloudMnaDeal,
  getCloudMnaDeals,
  type MnaDeal,
  type MnaDealEvent,
  type MnaDealPayload,
  type MnaDealsParams,
  type MnaDealsPayload,
  type MnaParty,
} from "../../../api-client/mna";
import type { PluginPersistence } from "../../../types/plugin";
import { withConnectionRequest } from "../connections/register";

export const MNA_CONNECTION_ID = "gloom-cloud-mna";

/**
 * Deals change when a story or a filing lands, a few times an hour at most,
 * so a list stays fresh for five minutes.
 */
const LIST_POLICY = { staleMs: 5 * 60_000, expireMs: 7 * 86_400_000 } as const;
const DEAL_POLICY = { staleMs: 5 * 60_000, expireMs: 30 * 86_400_000 } as const;
const LIST_KIND = "mna-deals";
const DEAL_KIND = "mna-deal";
const SOURCE_KEY = "gloom-cloud";
const SCHEMA_VERSION = 2;
const UNAVAILABLE = "M&A deals are not available on this server yet.";

const STATUSES = new Set(["talks", "pending", "completed", "terminated"]);
const CONSIDERATIONS = new Set(["cash", "stock", "mixed", "undisclosed"]);
const EVENT_KINDS = new Set([
  "talks", "announced", "amended", "filing", "tender", "vote", "regulatory", "completed", "terminated", "update",
]);

const day = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const text = (value: unknown): value is string => typeof value === "string";
const textOrNull = (value: unknown) => value === null || typeof value === "string";
const numberOrNull = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));

export interface MnaResource<T> {
  payload: T;
  stale: boolean;
  refreshError: string | null;
  fetchedAt: number;
}

let persistence: PluginPersistence | null = null;
let generation = 0;
const inflight = new Map<string, Promise<MnaResource<unknown>>>();

export function attachMnaPersistence(next: PluginPersistence): void {
  if (persistence !== next) resetMnaPersistence();
  persistence = next;
}

export function resetMnaPersistence(): void {
  generation += 1;
  persistence = null;
  inflight.clear();
}

function validParty(party: MnaParty | null | undefined): boolean {
  return !!party && text(party.name) && party.name.length > 0 && textOrNull(party.symbol) && textOrNull(party.country);
}

function validDeal(deal: MnaDeal): boolean {
  const terms = deal?.terms;
  return !!deal
    && text(deal.id) && deal.id.length > 0
    && validParty(deal.target)
    && (deal.acquirer === null || validParty(deal.acquirer))
    && STATUSES.has(deal.status)
    && textOrNull(deal.stage)
    && typeof deal.hostile === "boolean"
    && !!terms && CONSIDERATIONS.has(terms.consideration)
    && numberOrNull(terms.cashPerShare) && numberOrNull(terms.exchangeRatio)
    && textOrNull(terms.ratioSymbol) && textOrNull(terms.currency)
    && typeof terms.cvr === "boolean" && typeof terms.partial === "boolean"
    && numberOrNull(deal.value) && textOrNull(deal.valueCurrency) && numberOrNull(deal.valueUsd)
    && day(deal.announced)
    && textOrNull(deal.expectedClose)
    && (deal.closed === null || day(deal.closed))
    && text(deal.headline)
    && text(deal.updatedAt)
    && day(deal.lastReported)
    && typeof deal.stale === "boolean";
}

function validEvent(event: MnaDealEvent): boolean {
  return !!event && text(event.id) && day(event.date) && EVENT_KINDS.has(event.kind)
    && text(event.title) && text(event.source) && textOrNull(event.url);
}

function validateMnaDeals(data: MnaDealsPayload): MnaDealsPayload {
  const valid = !!data
    && Array.isArray(data.deals) && data.deals.every(validDeal)
    && typeof data.hasMore === "boolean"
    && Number.isInteger(data.nextOffset) && data.nextOffset >= 0
    && (data.access === "full" || data.access === "delayed")
    && Number.isInteger(data.delayDays) && data.delayDays >= 0
    && Number.isInteger(data.lockedDeals) && data.lockedDeals >= 0
    && text(data.asOf);
  if (!valid) throw new Error("The server returned an unreadable deal list");
  return data;
}

function validateMnaDeal(data: MnaDealPayload): MnaDealPayload {
  const valid = !!data
    && validDeal(data.deal)
    && Array.isArray(data.events) && data.events.every(validEvent)
    && (data.access === "full" || data.access === "delayed");
  if (!valid) throw new Error("The server returned an unreadable deal");
  return data;
}

export function isAccessDenied(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

function mapUnavailable(error: unknown): never {
  if (error instanceof ApiRequestError && (error.status ?? 0) === 404) {
    throw new Error(UNAVAILABLE);
  }
  throw error instanceof Error ? error : new Error(String(error));
}

export async function fetchMnaDeals(params: MnaDealsParams, signal?: AbortSignal): Promise<MnaDealsPayload> {
  try {
    return await withConnectionRequest(MNA_CONNECTION_ID, "deals", async () => (
      validateMnaDeals(await getCloudMnaDeals(params, signal))
    ));
  } catch (error) {
    mapUnavailable(error);
  }
}

export async function fetchMnaDeal(id: string, signal?: AbortSignal): Promise<MnaDealPayload> {
  try {
    return await withConnectionRequest(MNA_CONNECTION_ID, "deal", async () => (
      validateMnaDeal(await getCloudMnaDeal(id, signal))
    ));
  } catch (error) {
    mapUnavailable(error);
  }
}

function listKey(params: MnaDealsParams, pro: boolean): string {
  return JSON.stringify([
    params.status ?? "pending",
    params.target ?? "all",
    params.region ?? "all",
    params.symbol?.toUpperCase() ?? "",
    params.query?.trim().toLowerCase() ?? "",
    params.offset ?? 0,
    pro ? "full" : "delayed",
  ]);
}

function readCache<T>(kind: string, key: string, validate: (value: T) => T, allowExpired: boolean): MnaResource<T> | null {
  const record = persistence?.getResource<T>(kind, key, {
    sourceKey: SOURCE_KEY,
    schemaVersion: SCHEMA_VERSION,
    allowExpired,
  });
  if (!record) return null;
  try {
    return {
      payload: validate(record.value),
      stale: !!record.stale || !!record.expired,
      refreshError: null,
      fetchedAt: record.fetchedAt,
    };
  } catch {
    return null;
  }
}

function writeCache<T>(kind: string, key: string, value: T, policy: { staleMs: number; expireMs: number }, owner: number): void {
  if (owner !== generation || !persistence) return;
  persistence.setResource(kind, key, value, {
    sourceKey: SOURCE_KEY,
    schemaVersion: SCHEMA_VERSION,
    cachePolicy: policy,
  });
}

async function loadCached<T>(
  kind: string,
  key: string,
  policy: { staleMs: number; expireMs: number },
  validate: (value: T) => T,
  fetch: () => Promise<T>,
  force: boolean,
): Promise<MnaResource<T>> {
  if (!force) {
    const fresh = readCache(kind, key, validate, false);
    if (fresh && !fresh.stale) return fresh;
  }
  const flightKey = `${kind}:${key}:${force ? "1" : "0"}`;
  const existing = inflight.get(flightKey) as Promise<MnaResource<T>> | undefined;
  if (existing) return existing;
  const owner = generation;
  const fallback = readCache(kind, key, validate, true);
  const promise = fetch()
    .then((payload) => {
      const validated = validate(payload);
      writeCache(kind, key, validated, policy, owner);
      return { payload: validated, stale: false, refreshError: null, fetchedAt: Date.now() };
    })
    .catch((error: unknown) => {
      // A signed-out or forbidden response is not a stale copy of the list.
      if (isAccessDenied(error) || !fallback) throw error;
      return {
        ...fallback,
        stale: true,
        refreshError: error instanceof Error ? error.message : String(error),
      };
    })
    .finally(() => {
      inflight.delete(flightKey);
    });
  inflight.set(flightKey, promise as Promise<MnaResource<unknown>>);
  return promise;
}

export function peekMnaDeals(params: MnaDealsParams, pro: boolean): MnaResource<MnaDealsPayload> | null {
  return readCache(LIST_KIND, listKey(params, pro), validateMnaDeals, true);
}

export function loadMnaDeals(
  params: MnaDealsParams,
  pro: boolean,
  options: { force?: boolean } = {},
): Promise<MnaResource<MnaDealsPayload>> {
  const key = listKey(params, pro);
  return loadCached(LIST_KIND, key, LIST_POLICY, validateMnaDeals, () => fetchMnaDeals(params), !!options.force);
}

export function peekMnaDeal(id: string, pro: boolean): MnaResource<MnaDealPayload> | null {
  return readCache(DEAL_KIND, `${id}:${pro ? "full" : "delayed"}`, validateMnaDeal, true);
}

export function loadMnaDeal(
  id: string,
  pro: boolean,
  options: { force?: boolean } = {},
): Promise<MnaResource<MnaDealPayload>> {
  const key = `${id}:${pro ? "full" : "delayed"}`;
  return loadCached(DEAL_KIND, key, DEAL_POLICY, validateMnaDeal, () => fetchMnaDeal(id), !!options.force);
}

/** Appends a page by id; a deal that moved between pages keeps its first place. */
export function appendMnaDeals(current: MnaDealsPayload, page: MnaDealsPayload): MnaDealsPayload {
  const seen = new Set(current.deals.map((deal) => deal.id));
  return {
    ...page,
    deals: [...current.deals, ...page.deals.filter((deal) => !seen.has(deal.id))],
  };
}
