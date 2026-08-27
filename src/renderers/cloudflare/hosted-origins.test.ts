import { describe, expect, test } from "bun:test";
import { SHARE_HOSTED_ORIGIN } from "../../shares/routes";
import {
  HOSTED_WORKERS_DEV_ORIGIN,
  hasTrustedHostedOrigin,
  isTrustedHostedOrigin,
} from "./hosted-origins";

const CUSTOM = new URL(`${SHARE_HOSTED_ORIGIN}/cloud/sync/snapshot`);
const WORKERS = new URL(`${HOSTED_WORKERS_DEV_ORIGIN}/cloud/sync/snapshot`);

function request(method: string, url: URL, origin?: string): Request {
  const headers = new Headers();
  if (origin !== undefined) headers.set("Origin", origin);
  return new Request(url, { method, headers });
}

function requestWithHeaders(
  method: string,
  url: URL,
  headers: Record<string, string>,
): Request {
  return new Request(url, { method, headers: new Headers(headers) });
}

describe("hosted origin allowlist", () => {
  test("accepts the request host, custom domain, and workers.dev", () => {
    expect(isTrustedHostedOrigin(SHARE_HOSTED_ORIGIN, CUSTOM)).toBe(true);
    expect(isTrustedHostedOrigin(HOSTED_WORKERS_DEV_ORIGIN, CUSTOM)).toBe(true);
    expect(isTrustedHostedOrigin(SHARE_HOSTED_ORIGIN, WORKERS)).toBe(true);
    expect(isTrustedHostedOrigin(HOSTED_WORKERS_DEV_ORIGIN, WORKERS)).toBe(true);
    expect(isTrustedHostedOrigin("https://gloom.sh", CUSTOM)).toBe(false);
    expect(isTrustedHostedOrigin("https://api.gloom.sh", CUSTOM)).toBe(false);
    expect(isTrustedHostedOrigin("https://evil.example", CUSTOM)).toBe(false);
  });

  test("GET /cloud may omit Origin; PUT and cross-site Origin must not", () => {
    expect(hasTrustedHostedOrigin(request("GET", CUSTOM), CUSTOM)).toBe(true);
    expect(hasTrustedHostedOrigin(request("GET", CUSTOM, SHARE_HOSTED_ORIGIN), CUSTOM)).toBe(true);
    expect(hasTrustedHostedOrigin(request("GET", WORKERS, SHARE_HOSTED_ORIGIN), WORKERS)).toBe(true);
    expect(hasTrustedHostedOrigin(request("PUT", CUSTOM, SHARE_HOSTED_ORIGIN), CUSTOM)).toBe(true);
    expect(hasTrustedHostedOrigin(request("PUT", WORKERS, SHARE_HOSTED_ORIGIN), WORKERS)).toBe(true);
    expect(hasTrustedHostedOrigin(request("PUT", CUSTOM), CUSTOM)).toBe(false);
    expect(hasTrustedHostedOrigin(request("PUT", CUSTOM, "https://evil.example"), CUSTOM)).toBe(false);
    expect(hasTrustedHostedOrigin(request("GET", CUSTOM, "https://api.gloom.sh"), CUSTOM)).toBe(false);
  });

  test("POST without Origin passes via Sec-Fetch-Site same-origin fallback", () => {
    expect(
      hasTrustedHostedOrigin(
        requestWithHeaders("POST", CUSTOM, { "Sec-Fetch-Site": "same-origin" }),
        CUSTOM,
      ),
    ).toBe(true);
    expect(
      hasTrustedHostedOrigin(
        requestWithHeaders("PUT", CUSTOM, { "Sec-Fetch-Site": "same-origin" }),
        CUSTOM,
      ),
    ).toBe(true);
  });

  test("POST without Origin is rejected when Sec-Fetch-Site is cross-site", () => {
    expect(
      hasTrustedHostedOrigin(
        requestWithHeaders("POST", CUSTOM, { "Sec-Fetch-Site": "cross-site" }),
        CUSTOM,
      ),
    ).toBe(false);
  });

  test("POST without Origin falls back to Referer same-origin check", () => {
    expect(
      hasTrustedHostedOrigin(
        requestWithHeaders("POST", CUSTOM, { Referer: `${SHARE_HOSTED_ORIGIN}/cloud/auth` }),
        CUSTOM,
      ),
    ).toBe(true);
    expect(
      hasTrustedHostedOrigin(
        requestWithHeaders("POST", CUSTOM, { Referer: "https://evil.example/" }),
        CUSTOM,
      ),
    ).toBe(false);
  });

  test("POST without Origin, Sec-Fetch-Site, or Referer is rejected", () => {
    expect(hasTrustedHostedOrigin(request("POST", CUSTOM), CUSTOM)).toBe(false);
  });
});
