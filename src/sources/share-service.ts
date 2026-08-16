import { httpFetch } from "../utils/http-transport";

/**
 * Share payloads are stored on the hosted worker (Cloudflare KV) behind short
 * IDs so that share URLs stay compact: terminal.kohor.st/s/abc123 instead of
 * a long base64url blob in the query string.
 *
 * Creating a share requires a verified session (prevents anonymous abuse of
 * the storage backend). Resolving a share is public — anyone with the link
 * must be able to open it without an account.
 */

const SHARE_API_BASE = "/api/share";

export interface ShareEnvelope {
  kind: "article" | "chart";
  data: unknown;
  createdAt: string;
}

export interface CreateShareRequest {
  kind: ShareEnvelope["kind"];
  data: unknown;
}

export interface CreateShareResponse {
  id: string;
}

export interface ResolveShareResponse {
  kind: ShareEnvelope["kind"];
  data: unknown;
  createdAt: string;
}

function resolveShareApiBase(): string {
  // On the hosted web client, calls go to the same origin. On the desktop
  // client, shares are not created (the URL would be unreachable), so this
  // path is only exercised in the browser.
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${SHARE_API_BASE}`;
  }
  return SHARE_API_BASE;
}

/** Store a share payload and receive a compact short ID. */
export async function createShare(
  request: CreateShareRequest,
): Promise<CreateShareResponse> {
  const response = await httpFetch(resolveShareApiBase(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Failed to create share (${response.status})`);
  }
  return response.json() as Promise<CreateShareResponse>;
}

/** Retrieve a share payload by its short ID. Public — no session required. */
export async function resolveShare(
  id: string,
): Promise<ResolveShareResponse | null> {
  const base = resolveShareApiBase();
  const response = await httpFetch(`${base}/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to resolve share (${response.status})`);
  }
  return response.json() as Promise<ResolveShareResponse>;
}
