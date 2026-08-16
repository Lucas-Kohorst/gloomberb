import type { ChartSpec } from "../../../time-series/types";
import { SHARE_HOSTED_ORIGIN } from "./article-share";

// ---------------------------------------------------------------------------
// Share envelope — the unified payload stored behind a short ID or encoded
// inline in a URL.
// ---------------------------------------------------------------------------

export type ShareKind = "article" | "chart";

export interface ChartSharePayload {
  spec: ChartSpec;
}

export type SharePayloadData =
  | { kind: "article"; data: unknown }
  | { kind: "chart"; data: ChartSharePayload };

export interface ShareEnvelope {
  kind: ShareKind;
  data: unknown;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Short ID URL helpers
// ---------------------------------------------------------------------------

/**
 * Build a compact share URL: terminal.kohor.st/s/{shortId}
 */
export function buildShortShareUrl(shortId: string): string {
  return `${SHARE_HOSTED_ORIGIN}/s/${shortId}`;
}

/**
 * Extract a short ID from a `/s/{id}` pathname, or null if the path is not a
 * short-share route.
 */
export function parseShortShareId(pathname: string): string | null {
  const match = pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Public share location detection (onboarding bypass)
// ---------------------------------------------------------------------------

/**
 * Returns true when the current browser location is a public share URL that
 * should bypass the login/onboarding gate.
 *
 * This covers:
 *  - `/article?a={encoded}` — inline article share (existing)
 *  - `/s/{shortId}` — short-ID share (any kind: article, chart, layout)
 *
 * The check is strict: only valid, decodable share paths return true. A
 * garbage `/s/` path or an undecodable article payload will not bypass
 * onboarding — the visitor sees the normal sign-up flow instead.
 *
 * Keep this independent of the renderer so app bootstrap can call it before
 * the deep-link bridge has mounted.
 */
export function isPublicShareLocation(): boolean {
  if (typeof window === "undefined") return false;
  const { pathname, search } = window.location;

  // Inline article share: /article?a=...
  if (pathname === "/article") {
    const encoded = new URLSearchParams(search).get("a");
    // Decode inline to avoid importing article-share.ts (which would create
    // a circular dependency at module load time).
    if (encoded != null) {
      return decodeInlineArticlePayload(encoded) !== null;
    }
    return false;
  }

  // Short ID share: /s/{id}
  // We accept any well-formed short ID here; the actual payload resolution
  // happens after the app mounts. This keeps the bypass fast and avoids a
  // blocking network call during bootstrap.
  return parseShortShareId(pathname) !== null;
}

// ---------------------------------------------------------------------------
// Inline payload helpers (base64url, works in browser + Node + Bun)
// ---------------------------------------------------------------------------

function base64urlEncode(data: string): string {
  const bytes = new TextEncoder().encode(data);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(data, "utf-8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const base64 = pad ? padded + "=".repeat(4 - pad) : padded;
    if (typeof atob === "function") {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Encode a share envelope inline (for URL-embedded shares that don't need a
 * short ID). Returns a base64url string.
 */
export function encodeShareEnvelope(envelope: Omit<ShareEnvelope, "createdAt">): string {
  return base64urlEncode(JSON.stringify(envelope));
}

/**
 * Decode an inline base64url share envelope. Returns null if the payload is
 * invalid or malformed.
 */
export function decodeShareEnvelope(encoded: string): ShareEnvelope | null {
  const json = base64urlDecode(encoded);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.kind !== "string") return null;
    if (parsed.kind !== "article" && parsed.kind !== "chart") return null;
    if (typeof parsed.createdAt !== "string" && parsed.createdAt !== undefined) return null;
    return {
      kind: parsed.kind,
      data: parsed.data,
      createdAt: parsed.createdAt ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Validate an inline article share payload (used by isPublicShareLocation to
 * avoid importing the full article-share module at bootstrap time).
 */
function decodeInlineArticlePayload(encoded: string): unknown {
  const json = base64urlDecode(encoded);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.id !== "string" || typeof parsed.title !== "string") return null;
    if (parsed.type !== "news" && parsed.type !== "substack") return null;
    return parsed;
  } catch {
    return null;
  }
}
