import { afterEach, describe, expect, test } from "bun:test";
import type { PluginPersistence } from "../../../types/plugin";
import type { SecFilingItem } from "../../../types/data-provider";
import { AiRunCancelledError, setAiRuntimeCatalog, type AiRuntimeCatalog } from "../ai/runner";
import {
  attachSecSummaryPersistence,
  resetSecSummaryPersistence,
} from "./summary-cache";
import { SEC_REDFLAG_KEYWORDS } from "./summary-contract";
import {
  BROWSER_MODEL_DOWNLOAD_MESSAGE,
  isAiRunCancelled,
  summarizeFiling,
  type SummaryAiRunner,
} from "./summary-runner";

function filing(accessionNumber: string, form = "10-K", date = "2026-01-01"): SecFilingItem {
  return {
    accessionNumber,
    form,
    filingDate: new Date(date) as unknown as Date,
    cik: "0001234567",
    companyName: "Test Corp",
    ticker: "TEST",
    filingUrl: `https://example.com/${accessionNumber}`,
    primaryDocument: "filing.htm",
  };
}

function connectedCatalog(): AiRuntimeCatalog {
  return {
    providers: [{
      providerId: "openai-codex",
      label: "OpenAI (ChatGPT)",
      status: "ready",
      outputModes: ["plain", "structured", "screener"],
      defaultModelId: "gpt-5.6-sol",
    }],
    accounts: [{
      providerId: "openai-codex",
      providerLabel: "OpenAI (ChatGPT)",
      connectionState: "connected",
      connectionLabel: "Connected with OAuth",
      credentialSource: "OAuth",
      credentialOrigin: "stored",
      authMethods: [{ type: "oauth", label: "ChatGPT Plus/Pro", canLogin: true }],
      canLogin: true,
      canDisconnect: true,
      loginType: "oauth",
    }],
    models: [{ id: "gpt-5.6-sol", providerId: "openai-codex", label: "GPT-5.6 Sol", available: true }],
  };
}

function readyProviders() {
  return [{
    id: "openai-codex" as const,
    name: "OpenAI (ChatGPT)",
    available: true,
    status: "ready" as const,
    outputModes: ["plain", "structured", "screener"] as const,
    defaultModelId: "gpt-5.6-sol",
  }];
}

interface FakeStore {
  value: unknown;
  stale: boolean;
  expired: boolean;
}

function fakePersistence(seed?: Map<string, FakeStore>) {
  const store = seed ?? new Map<string, FakeStore>();
  const writes: { key: string; value: unknown }[] = [];
  const persistence = {
    getResource: <T,>(kind: string, key: string, options?: { allowExpired?: boolean }) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expired && !options?.allowExpired) return null;
      return { value: entry.value as T, fetchedAt: 1_000, stale: entry.stale };
    },
    setResource: <T,>(kind: string, key: string, value: T) => {
      writes.push({ key, value });
      store.set(key, { value, stale: false, expired: false });
      return { value, fetchedAt: Date.now(), stale: false };
    },
    deleteResource: (kind: string, key: string) => {
      store.delete(key);
    },
  } as unknown as PluginPersistence;
  return { persistence, writes, store };
}

function fakeRun(output: string, capture?: { prompt?: string }) {
  const run: SummaryAiRunner = (options) => {
    if (capture) capture.prompt = options.prompt;
    return { done: Promise.resolve(output), cancel: () => {} };
  };
  return run;
}

const SUMMARY_JSON = JSON.stringify({
  executiveSummary: "Sentence one. Sentence two. Sentence three.",
  riskFactors: ["Risk A.", "Risk B."],
  notableChanges: "Changed X.",
});

const originalLanguageModel = (globalThis as { LanguageModel?: unknown }).LanguageModel;

afterEach(() => {
  resetSecSummaryPersistence();
  setAiRuntimeCatalog({ providers: [], accounts: [], models: [] });
  (globalThis as { LanguageModel?: unknown }).LanguageModel = originalLanguageModel;
  delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
});

function readyBrowserProviders() {
  return [{
    id: "browser-builtin" as const,
    name: "Browser (on-device)",
    available: true,
    status: "ready" as const,
    outputModes: ["plain", "screener"] as const,
    defaultModelId: "gemini-nano",
  }];
}

describe("summarizeFiling", () => {
  test("generates a summary, detects red flags, and writes the cache", async () => {
    setAiRuntimeCatalog(connectedCatalog());
    const { persistence, writes } = fakePersistence();
    attachSecSummaryPersistence(persistence);
    const content = `Filing body. ${SEC_REDFLAG_KEYWORDS[0]} noted here.`;

    const result = await summarizeFiling({
      filing: filing("A1"),
      content,
      providers: readyProviders(),
      run: fakeRun(SUMMARY_JSON),
    });

    expect(result.cached).toBe(false);
    expect(result.providerId).toBe("openai-codex");
    expect(result.summary.executiveSummary).toBe("Sentence one. Sentence two. Sentence three.");
    expect(result.summary.riskFactors).toEqual(["Risk A.", "Risk B."]);
    expect(result.summary.notableChanges).toBe("Changed X.");
    expect(result.summary.redFlags).toContain(SEC_REDFLAG_KEYWORDS[0]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.key).toBe("A1");
  });

  test("serves a fresh cache entry without calling the runner", async () => {
    setAiRuntimeCatalog(connectedCatalog());
    const seed = new Map<string, FakeStore>([["A1", {
      value: {
        executiveSummary: "Cached summary.",
        riskFactors: ["Cached risk."],
        notableChanges: null,
        redFlags: [],
        generatedAt: 1,
        providerId: "openai-codex",
      },
      stale: false,
      expired: false,
    }]]);
    const { persistence } = fakePersistence(seed);
    attachSecSummaryPersistence(persistence);
    let called = 0;

    const result = await summarizeFiling({
      filing: filing("A1"),
      content: "ignored",
      providers: readyProviders(),
      run: () => { called += 1; return { done: Promise.resolve(""), cancel: () => {} }; },
    });

    expect(called).toBe(0);
    expect(result.cached).toBe(true);
    expect(result.summary.executiveSummary).toBe("Cached summary.");
  });

  test("regenerates when the cached entry is stale", async () => {
    setAiRuntimeCatalog(connectedCatalog());
    const seed = new Map<string, FakeStore>([["A1", {
      value: {
        executiveSummary: "Stale cached summary.",
        riskFactors: [],
        notableChanges: null,
        redFlags: [],
        generatedAt: 1,
        providerId: "openai-codex",
      },
      stale: true,
      expired: false,
    }]]);
    const { persistence } = fakePersistence(seed);
    attachSecSummaryPersistence(persistence);
    let called = 0;

    const result = await summarizeFiling({
      filing: filing("A1"),
      content: "fresh body",
      providers: readyProviders(),
      run: () => { called += 1; return { done: Promise.resolve(SUMMARY_JSON), cancel: () => {} }; },
    });

    expect(called).toBe(1);
    expect(result.cached).toBe(false);
    expect(result.summary.executiveSummary).toBe("Sentence one. Sentence two. Sentence three.");
  });

  test("force=true bypasses a fresh cache entry", async () => {
    setAiRuntimeCatalog(connectedCatalog());
    const seed = new Map<string, FakeStore>([["A1", {
      value: {
        executiveSummary: "Fresh cached.",
        riskFactors: [],
        notableChanges: null,
        redFlags: [],
        generatedAt: 1,
        providerId: "openai-codex",
      },
      stale: false,
      expired: false,
    }]]);
    const { persistence } = fakePersistence(seed);
    attachSecSummaryPersistence(persistence);
    let called = 0;

    const result = await summarizeFiling({
      filing: filing("A1"),
      content: "fresh body",
      providers: readyProviders(),
      run: () => { called += 1; return { done: Promise.resolve(SUMMARY_JSON), cancel: () => {} }; },
      force: true,
    });

    expect(called).toBe(1);
    expect(result.summary.executiveSummary).toBe("Sentence one. Sentence two. Sentence three.");
  });

  test("passes prior comparable filing content to the prompt", async () => {
    setAiRuntimeCatalog(connectedCatalog());
    const { persistence } = fakePersistence();
    attachSecSummaryPersistence(persistence);
    const current = filing("A1", "10-K", "2026-01-01");
    const prior = filing("A0", "10-K", "2025-01-01");
    const contentCache = new Map<string, string | null>([["A0", "prior filing body text"]]);
    const capture: { prompt?: string } = {};

    await summarizeFiling({
      filing: current,
      content: "current body",
      filings: [prior, current],
      contentCache,
      providers: readyProviders(),
      run: fakeRun(SUMMARY_JSON, capture),
    });

    expect(capture.prompt).toContain("Prior comparable filing for change analysis:");
    expect(capture.prompt).toContain("prior filing body text");
  });

  test("throws when no provider is available", async () => {
    setAiRuntimeCatalog(connectedCatalog());
    const { persistence } = fakePersistence();
    attachSecSummaryPersistence(persistence);

    await expect(summarizeFiling({
      filing: filing("A1"),
      content: "body",
      providers: [],
      run: fakeRun(SUMMARY_JSON),
    })).rejects.toThrow(/No AI provider is available/);
  });

  test("summarizes with a ready browser provider without a catalog account", async () => {
    Object.defineProperty(globalThis, "__GLOOM_CLOUD_HOSTED", { configurable: true, value: true });
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => "available",
      create: async () => ({}),
    };
    const { persistence } = fakePersistence();
    attachSecSummaryPersistence(persistence);

    const result = await summarizeFiling({
      filing: filing("A1"),
      content: "Filing body.",
      providers: readyBrowserProviders(),
      run: fakeRun(SUMMARY_JSON),
    });
    expect(result.providerId).toBe("browser-builtin");
    expect(result.summary.executiveSummary).toBe("Sentence one. Sentence two. Sentence three.");
  });

  test("tells the user to download the Chrome model when it is downloadable", async () => {
    Object.defineProperty(globalThis, "__GLOOM_CLOUD_HOSTED", { configurable: true, value: true });
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => "downloadable",
      create: async () => ({}),
    };
    const { persistence } = fakePersistence();
    attachSecSummaryPersistence(persistence);
    let called = 0;

    await expect(summarizeFiling({
      filing: filing("A1"),
      content: "body",
      providers: readyBrowserProviders(),
      run: () => {
        called += 1;
        return fakeRun(SUMMARY_JSON)({ providerId: "browser-builtin", prompt: "" });
      },
    })).rejects.toThrow(BROWSER_MODEL_DOWNLOAD_MESSAGE);
    expect(called).toBe(0);
  });

  test("throws when the provider is not ready", async () => {
    setAiRuntimeCatalog({ providers: [], accounts: [], models: [] });
    const { persistence } = fakePersistence();
    attachSecSummaryPersistence(persistence);

    await expect(summarizeFiling({
      filing: filing("A1"),
      content: "body",
      providers: [{ id: "openai-codex" as const, name: "OpenAI", available: false, status: "not_authenticated" as const, outputModes: ["plain"] as const }],
      run: fakeRun(SUMMARY_JSON),
    })).rejects.toThrow(/not connected|is not ready/i);
  });

  test("propagates AI run failures as an error", async () => {
    setAiRuntimeCatalog(connectedCatalog());
    const { persistence } = fakePersistence();
    attachSecSummaryPersistence(persistence);

    await expect(summarizeFiling({
      filing: filing("A1"),
      content: "body",
      providers: readyProviders(),
      run: () => ({ done: Promise.reject(new Error("boom")), cancel: () => {} }),
    })).rejects.toThrow(/AI summary failed: boom/);
  });

  test("treats cancelled runs as cancelled, not failures", async () => {
    setAiRuntimeCatalog(connectedCatalog());
    const { persistence } = fakePersistence();
    attachSecSummaryPersistence(persistence);

    const cancelled = summarizeFiling({
      filing: filing("A1"),
      content: "body",
      providers: readyProviders(),
      run: () => ({ done: Promise.reject(new AiRunCancelledError()), cancel: () => {} }),
    });
    // The cancellation must survive as-is rather than being rewrapped as
    // "AI summary failed", which is what callers key off to stay silent.
    await expect(cancelled).rejects.toBeInstanceOf(AiRunCancelledError);
    expect(await cancelled.then(() => null, (error: unknown) => isAiRunCancelled(error))).toBe(true);
  });
});
