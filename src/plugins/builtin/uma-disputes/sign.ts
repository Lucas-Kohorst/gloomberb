/**
 * HMAC-SHA256 request signing for the Bravado partner API.
 * Payload shape: https://docs.bravadotrade.com/authentication
 * Query keys are sorted; values are URL-encoded.
 */

export interface BravadoCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface SignedBravadoHeaders {
  "X-BRAVADO-API-KEY": string;
  "X-BRAVADO-TIMESTAMP": string;
  "X-BRAVADO-SIGNATURE": string;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToHex(new Uint8Array(signature));
}

/** Sorted query string. Empty when there is nothing to sign. */
export function canonicalQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && String(entry[1]) !== "")
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

/** Path plus canonical query, the exact string that is signed and requested. */
export function canonicalPath(path: string, params: Record<string, string | number | undefined>): string {
  const query = canonicalQuery(params);
  return query ? `${path}?${query}` : path;
}

/**
 * Four newline-joined fields, no trailing newline:
 * timestamp, UPPERCASE method, canonical path, sha256 of the exact body.
 */
export async function bravadoSignaturePayload(
  timestamp: string,
  method: string,
  pathWithQuery: string,
  body = "",
): Promise<string> {
  const bodyHash = await sha256Hex(body);
  return [timestamp, method.toUpperCase(), pathWithQuery, bodyHash].join("\n");
}

export async function signBravadoRequest(options: {
  credentials: BravadoCredentials;
  method: string;
  pathWithQuery: string;
  body?: string;
  timestampMs?: number;
}): Promise<SignedBravadoHeaders> {
  const timestamp = String(options.timestampMs ?? Date.now());
  const payload = await bravadoSignaturePayload(
    timestamp,
    options.method,
    options.pathWithQuery,
    options.body ?? "",
  );
  const signature = await hmacSha256Hex(options.credentials.apiSecret, payload);
  return {
    "X-BRAVADO-API-KEY": options.credentials.apiKey,
    "X-BRAVADO-TIMESTAMP": timestamp,
    "X-BRAVADO-SIGNATURE": signature,
  };
}
