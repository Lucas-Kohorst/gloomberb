import { afterEach, describe, expect, test } from "bun:test";
import {
  browserAiProviderStatus,
  createBrowserAiRunHost,
  getBrowserAiState,
  type BrowserAiAvailability,
} from "./browser";
import { parseAssistCommandOutput } from "./assist-local";

const originalLanguageModel = (globalThis as { LanguageModel?: unknown }).LanguageModel;

afterEach(() => {
  (globalThis as { LanguageModel?: unknown }).LanguageModel = originalLanguageModel;
});

describe("Chrome built-in AI detection", () => {
  for (const availability of ["available", "downloadable", "downloading", "unavailable"] as BrowserAiAvailability[]) {
    test(`maps ${availability} without requiring a browser`, async () => {
      (globalThis as { LanguageModel?: unknown }).LanguageModel = {
        availability: async () => availability,
        create: async () => ({}),
      };
      const state = await getBrowserAiState();
      expect(state.availability).toBe(availability);
      expect(browserAiProviderStatus(state).status).toBe(
        availability === "available" || availability === "downloadable" ? "ready" : "check_failed",
      );
    });
  }

  test("detects Chrome's LanguageModel constructor function", async () => {
    function LanguageModel() {}
    LanguageModel.availability = async () => "available" as const;
    LanguageModel.create = async () => ({});
    (globalThis as { LanguageModel?: unknown }).LanguageModel = LanguageModel;
    expect((await getBrowserAiState()).availability).toBe("available");
  });

  test("treats an absent or throwing global as unavailable", async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = undefined;
    expect((await getBrowserAiState()).availability).toBe("unavailable");
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => { throw new Error("unsupported"); },
      create: async () => ({}),
    };
    expect((await getBrowserAiState()).availability).toBe("unavailable");
  });
});

describe("createBrowserAiRunHost", () => {
  test("runs the Prompt API controller and streams deltas", async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => "available",
      create: async () => ({
        promptStreaming: async function* () {
          yield "Hel";
          yield "Hello";
        },
        destroy() {},
      }),
    };
    const host = createBrowserAiRunHost();
    const catalog = await host.getCatalog?.();
    expect(catalog?.providers[0]?.providerId).toBe("browser-builtin");
    const chunks: string[] = [];
    const output = await host.run({
      providerId: "browser-builtin",
      prompt: "hi",
      onChunk: (chunk) => chunks.push(chunk),
    }).done;
    expect(output).toBe("Hello");
    expect(chunks.join("")).toBe("Hello");
  });

  test("rejects cloud provider ids on the hosted host", async () => {
    const host = createBrowserAiRunHost();
    await expect(host.run({
      providerId: "anthropic",
      prompt: "hi",
    }).done).rejects.toThrow(/not available in the hosted client/);
  });
});

describe("browser assist JSON", () => {
  test("parses candidates and drops unknown prefixes", () => {
    const parsed = parseAssistCommandOutput(
      '```json\n{"candidates":[{"input":"SEC NVDA","title":"Filings","prefix":"SEC","confidence":0.9},{"input":"ZZZ","title":"Nope","prefix":"ZZZ","confidence":0.1}]}\n```',
      [{ prefix: "SEC", name: "Filings" }],
    );
    expect(parsed.candidates).toEqual([
      { input: "SEC NVDA", title: "Filings", prefix: "SEC", confidence: 0.9 },
    ]);
  });
});
