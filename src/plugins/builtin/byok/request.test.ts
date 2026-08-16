import { afterEach, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import {
  applyByokQueryAuth,
  buildByokAuthHeaders,
  fetchByokEndpoint,
  isByokTestSuccess,
  resolveByokRequestUrl,
  ByokRequestError,
} from "./request";
import { BYOK_CUSTOM_SERVICE_ID, type ByokApiKeyEntry } from "./types";

function entry(patch: Partial<ByokApiKeyEntry> = {}): ByokApiKeyEntry {
  return {
    id: "byok-1",
    serviceId: BYOK_CUSTOM_SERVICE_ID,
    name: "Furnace",
    apiKey: "secret-key",
    apiUrl: "https://api.example.com/v1",
    dataFormat: "json",
    createdAt: 1,
    lastValidationStatus: "untested",
    ...patch,
  };
}

afterEach(() => {
  setHttpFetchTransport(null);
});

describe("byok request helpers", () => {
  test("sends a bearer token for custom APIs", () => {
    expect(buildByokAuthHeaders(entry())).toEqual({ Authorization: "Bearer secret-key" });
  });

  test("uses the custom URL and known-service URL fallback", () => {
    expect(resolveByokRequestUrl(entry())).toBe("https://api.example.com/v1");
    expect(resolveByokRequestUrl(entry({
      serviceId: "adjacent",
      apiUrl: undefined,
    }))).toBe("https://api.adjacent.markets");
  });

  test("leaves the URL unchanged when auth is not query-based", () => {
    const next = applyByokQueryAuth("https://example.com/data", entry({
      serviceId: "sec-edgar",
      apiKey: "me@example.com",
    }));
    expect(next).toBe("https://example.com/data");
  });

  test("treats only HTTP success as a passing custom-key test", () => {
    expect(isByokTestSuccess(entry(), { ok: true, status: 200, contentType: "", body: "" })).toBe(true);
    expect(isByokTestSuccess(entry(), { ok: false, status: 401, contentType: "", body: "" })).toBe(false);
    expect(isByokTestSuccess(entry({ serviceId: "adjacent" }), {
      ok: false,
      status: 401,
      contentType: "",
      body: "",
    })).toBe(true);
  });

  test("fetches a custom endpoint with auth headers", async () => {
    const seen: Array<{ url: string; headers: HeadersInit | undefined }> = [];
    setHttpFetchTransport(async (url, init) => {
      seen.push({ url, headers: init?.headers });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await fetchByokEndpoint(entry());
    expect(result).toEqual({
      ok: true,
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
    expect(seen).toEqual([{
      url: "https://api.example.com/v1",
      headers: {
        Accept: "application/json, text/csv, text/plain, */*",
        Authorization: "Bearer secret-key",
      },
    }]);
  });

  test("throws ByokRequestError when no URL is configured", async () => {
    await expect(fetchByokEndpoint(entry({ apiUrl: "" }))).rejects.toBeInstanceOf(ByokRequestError);
  });
});
