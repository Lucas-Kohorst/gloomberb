import { apiClient } from "../api-client";
import { ApiRequestError } from "../api-client/errors";
import { parseSharePayload, type SharePayload } from "./payload";
import {
  encodeNewsPathId,
  isCanonicalNewsId,
  isStoredShareId,
  PUBLIC_SHARE_ORIGIN,
} from "./routes";
import { isShareId } from "./short-id";
export { PUBLIC_SHARE_ORIGIN, publicShareUrl, openLiveShareUrl, parseShareId } from "./routes";

declare const __GLOOMBERB_API_URL__: string | undefined;

const bundledApiOrigin = typeof __GLOOMBERB_API_URL__ === "string" ? __GLOOMBERB_API_URL__ : "";
export const SHARE_API_ORIGIN = bundledApiOrigin
  ? typeof location !== "undefined" && bundledApiOrigin === location.origin
    ? `${bundledApiOrigin}/api`
    : bundledApiOrigin
  : "https://api.gloom.sh";

/**
 * Article-id index lives on the hosted worker, not Cloud. Desktop still
 * publishes Cloud snapshots to api.gloom.sh, then registers the mapping here
 * so `/news/{id}` can resolve.
 */
export const NEWS_INDEX_API_ORIGIN = bundledApiOrigin
  && typeof location !== "undefined"
  && bundledApiOrigin === location.origin
  ? `${bundledApiOrigin}/api`
  : `${PUBLIC_SHARE_ORIGIN}/api`;

type ShareFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type ShareRecord = SharePayload & {
  createdAt: string;
  expiresAt: string;
  ownedByViewer: boolean;
};

export interface CreatedShare {
  id: string;
  expiresAt: string;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new Error("The share service returned an invalid response."); }
}

export async function createShare(payload: SharePayload, fetchImpl?: ShareFetch): Promise<CreatedShare> {
  const validated = parseSharePayload(payload);
  if (!validated) throw new Error("Invalid share payload.");
  let body: unknown;
  if (fetchImpl) {
    const response = await fetchImpl(`${SHARE_API_ORIGIN}/shares`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validated),
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error("Sign in to Gloom Cloud to share.");
      if (response.status === 403) throw new Error("Verify your Gloom Cloud email to share.");
      throw new Error("Could not create share.");
    }
    body = await readJson(response);
  } else {
    try {
      body = await apiClient.createTerminalShare(validated);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) throw new Error("Sign in to Gloom Cloud to share.");
      if (error instanceof ApiRequestError && error.status === 403) throw new Error("Verify your Gloom Cloud email to share.");
      throw error;
    }
  }
  if (!body || typeof body !== "object") throw new Error("The share service returned an invalid response.");
  const { id, expiresAt } = body as Record<string, unknown>;
  if (typeof id !== "string" || !isStoredShareId(id) || !validDate(expiresAt)) {
    throw new Error("The share service returned an invalid response.");
  }
  return { id, expiresAt };
}

const HOSTED_SHARE_TTL_MS = 60 * 60 * 24 * 30 * 1000;

function parseShareRecord(body: unknown): ShareRecord | null {
  if (!body || typeof body !== "object") return null;
  const object = body as Record<string, unknown>;
  const payload = parseSharePayload({ kind: object.kind, data: object.data });
  if (!payload || !validDate(object.createdAt)) return null;
  const expiresAt = validDate(object.expiresAt)
    ? object.expiresAt
    : new Date(Date.parse(object.createdAt) + HOSTED_SHARE_TTL_MS).toISOString();
  return {
    ...payload,
    createdAt: object.createdAt,
    expiresAt,
    ownedByViewer: object.ownedByViewer === true,
  };
}

export async function getShare(
  id: string,
  fetchImpl: ShareFetch = fetch,
  options?: { trackView?: boolean },
): Promise<ShareRecord | null> {
  if (isStoredShareId(id)) {
    const purpose = options?.trackView === false ? "?purpose=open" : "";
    const response = await fetchImpl(`${SHARE_API_ORIGIN}/shares/${encodeURIComponent(id)}${purpose}`, {
      credentials: "include",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Could not load share.");
    return parseShareRecord(await readJson(response));
  }
  if (!isShareId(id)) return null;
  const response = await fetchImpl(`${NEWS_INDEX_API_ORIGIN}/share/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not load share.");
  return parseShareRecord(await readJson(response));
}

/** Unsigned article snapshots on the hosted worker, used when Cloud is unavailable. */
export async function createHostedShare(
  payload: SharePayload,
  fetchImpl: ShareFetch = fetch,
): Promise<CreatedShare | null> {
  const validated = parseSharePayload(payload);
  if (!validated) return null;
  try {
    const response = await fetchImpl(`${NEWS_INDEX_API_ORIGIN}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validated),
    });
    if (!response.ok) return null;
    const body = await readJson(response);
    if (!body || typeof body !== "object") return null;
    const id = (body as { id?: unknown }).id;
    if (typeof id !== "string" || !isShareId(id)) return null;
    return { id, expiresAt: new Date(Date.now() + HOSTED_SHARE_TTL_MS).toISOString() };
  } catch {
    return null;
  }
}

export async function deleteShare(id: string, fetchImpl: ShareFetch = fetch): Promise<void> {
  if (!isStoredShareId(id)) throw new Error("Invalid share id.");
  const response = await fetchImpl(`${SHARE_API_ORIGIN}/shares/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (response.status !== 204) {
    throw new Error(response.status === 401 || response.status === 403
      ? "Only the signed-in owner can delete this share."
      : "Could not delete share.");
  }
}

export type NewsShareRecord = ShareRecord & { id: string };

function newsIndexUrl(articleId: string): string {
  return `${NEWS_INDEX_API_ORIGIN}/news/${encodeNewsPathId(articleId)}`;
}

function parseNewsShareRecord(body: unknown): NewsShareRecord | null {
  if (!body || typeof body !== "object") return null;
  const object = body as Record<string, unknown>;
  const payload = parseSharePayload({ kind: object.kind, data: object.data });
  if (!payload || !validDate(object.createdAt) || !validDate(object.expiresAt)) return null;
  const id = typeof object.shareId === "string" && isStoredShareId(object.shareId)
    ? object.shareId
    : typeof object.id === "string" && isStoredShareId(object.id)
      ? object.id
      : null;
  if (!id) return null;
  return {
    ...payload,
    id,
    createdAt: object.createdAt,
    expiresAt: object.expiresAt,
    ownedByViewer: object.ownedByViewer === true,
  };
}

/** Public lookup: hosted article-id index, then the Cloud snapshot it points at. */
export async function getNewsShare(
  articleId: string,
  fetchImpl: ShareFetch = fetch,
): Promise<NewsShareRecord | null> {
  if (!isCanonicalNewsId(articleId)) return null;
  const response = await fetchImpl(newsIndexUrl(articleId));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not load share.");
  return parseNewsShareRecord(await readJson(response));
}

export async function lookupNewsShareId(
  articleId: string,
  fetchImpl: ShareFetch = fetch,
): Promise<string | null> {
  try {
    return (await getNewsShare(articleId, fetchImpl))?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Point `/news/{articleId}` at a Cloud share whose stored article id matches.
 * First live mapping wins; a stale Cloud 404 can be replaced.
 */
export async function registerNewsShare(
  articleId: string,
  shareId: string,
  fetchImpl: ShareFetch = fetch,
): Promise<boolean> {
  if (!isCanonicalNewsId(articleId) || !isStoredShareId(shareId)) return false;
  try {
    const response = await fetchImpl(newsIndexUrl(articleId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shareId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
