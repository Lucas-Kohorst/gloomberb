import { afterEach, describe, expect, test } from "bun:test";
import {
  browserAiProviderStatus,
  getBrowserAiState,
  type BrowserAiAvailability,
} from "./browser";

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
