import { afterEach, describe, expect, test } from "bun:test";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import {
  ArtificialAnalysisAuthError,
  clearArtificialAnalysisCache,
  fetchArtificialAnalysisData,
  resolveArtificialAnalysisApiKey,
} from "./client";
import { ARTIFICIAL_ANALYSIS_ENV_VAR } from "./types";

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers || typeof headers !== "object" || Array.isArray(headers) || headers instanceof Headers) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

function jsonResponse(status: number, body: unknown = { data: [], pagination: { has_more: false } }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withClearedEnvKey(run: () => Promise<void>): Promise<void> {
  const previous = process.env[ARTIFICIAL_ANALYSIS_ENV_VAR];
  delete process.env[ARTIFICIAL_ANALYSIS_ENV_VAR];
  try {
    await run();
  } finally {
    if (previous == null) delete process.env[ARTIFICIAL_ANALYSIS_ENV_VAR];
    else process.env[ARTIFICIAL_ANALYSIS_ENV_VAR] = previous;
  }
}

afterEach(() => {
  setHttpFetchTransport(null);
  clearArtificialAnalysisCache();
});

describe("artificial analysis client", () => {
  test("resolveArtificialAnalysisApiKey does not throw when process is missing", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
    try {
      Object.defineProperty(globalThis, "process", {
        configurable: true,
        get() {
          throw new ReferenceError("process is not defined");
        },
      });
      expect(resolveArtificialAnalysisApiKey()).toBeUndefined();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "process", descriptor);
    }
  });

  test("fetches AA endpoints without a client key so hosted can inject x-api-key", async () => {
    await withClearedEnvKey(async () => {
      const calls: Array<{ url: string; apiKey?: string }> = [];
      setHttpFetchTransport(async (url, init) => {
        calls.push({ url: String(url), apiKey: headerRecord(init?.headers)["x-api-key"] });
        return jsonResponse(200);
      });

      const data = await fetchArtificialAnalysisData({ force: true });
      expect(data.rows).toEqual([]);
      expect(calls.some((call) => call.url.includes("/language/models/free"))).toBe(true);
      expect(calls.every((call) => call.apiKey == null || call.apiKey === "")).toBe(true);
    });
  });

  test("401 and first-page 403 are unauthorized after fetch, not a missing-key throw", async () => {
    await withClearedEnvKey(async () => {
      setHttpFetchTransport(async () => jsonResponse(401));
      await expect(fetchArtificialAnalysisData({ force: true })).rejects.toMatchObject({
        name: "ArtificialAnalysisAuthError",
        code: "unauthorized",
      });

      clearArtificialAnalysisCache();
      setHttpFetchTransport(async () => jsonResponse(403));
      await expect(fetchArtificialAnalysisData({ force: true })).rejects.toBeInstanceOf(
        ArtificialAnalysisAuthError,
      );
    });
  });
});
