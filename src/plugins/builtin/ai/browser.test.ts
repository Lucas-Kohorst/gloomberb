import { afterEach, describe, expect, test } from "bun:test";
import {
  browserAiProviderStatus,
  createBrowserAiRunHost,
  getBrowserAiState,
  parseBrowserRemoteControlRequest,
  type BrowserAiAvailability,
} from "./browser";
import { parseAssistCommandOutput } from "./assist-local";
import { setInProcessRemoteHandle } from "../../../remote/in-process-handle";
import type { RemoteControlRequest } from "../../../remote/types";
import type { AiAgentHistoryMessage } from "./agent-history";

const originalLanguageModel = (globalThis as { LanguageModel?: unknown }).LanguageModel;

afterEach(() => {
  (globalThis as { LanguageModel?: unknown }).LanguageModel = originalLanguageModel;
  setInProcessRemoteHandle(null);
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

  test("structured output parses JSON remote requests through the in-process handle", async () => {
    const requests: RemoteControlRequest[] = [];
    setInProcessRemoteHandle(async (request) => {
      requests.push(request);
      return { ok: true, data: { opened: true } };
    });
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => "available",
      create: async () => ({
        prompt: async () => '```json\n{"type":"call","operation":"pane.show","input":{"paneId":"sec"}}\n```',
        destroy() {},
      }),
    };
    const host = createBrowserAiRunHost();
    const agentMessages: AiAgentHistoryMessage[] = [];
    const output = await host.run({
      providerId: "browser-builtin",
      prompt: "open SEC",
      outputMode: "structured",
      onAgentMessages: (messages) => agentMessages.push(...messages),
    }).done;
    expect(requests).toEqual([{
      type: "call",
      operation: "pane.show",
      input: { paneId: "sec" },
    }]);
    expect(output).toContain("opened");
    expect(agentMessages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: [expect.objectContaining({
          type: "toolCall",
          name: "gloomberb_remote",
        })],
      }),
      expect.objectContaining({
        role: "toolResult",
        toolName: "gloomberb_remote",
        isError: false,
      }),
    ]);
  });

  test("structured output refuses capability.invoke without calling the handle", async () => {
    const requests: RemoteControlRequest[] = [];
    setInProcessRemoteHandle(async (request) => {
      requests.push(request);
      return { ok: true, data: {} };
    });
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => "available",
      create: async () => ({
        prompt: async () => JSON.stringify({
          type: "call",
          operation: "capability.invoke",
          input: { capabilityId: "news", operationId: "search" },
        }),
        destroy() {},
      }),
    };
    const host = createBrowserAiRunHost();
    const output = await host.run({
      providerId: "browser-builtin",
      prompt: "search news",
      outputMode: "structured",
    }).done;
    expect(requests).toEqual([]);
    expect(output).toMatch(/capability\.invoke/);
  });
});

describe("parseBrowserRemoteControlRequest", () => {
  test("accepts fenced JSON and nested request wrappers", () => {
    expect(parseBrowserRemoteControlRequest(
      '```json\n{"type":"get","resource":"app://connections"}\n```',
    )).toEqual({ type: "get", resource: "app://connections" });
    expect(parseBrowserRemoteControlRequest(JSON.stringify({
      request: { type: "call", operation: "layout.undo" },
    }))).toEqual({ type: "call", operation: "layout.undo" });
  });

  test("ignores prose that is not a remote request", () => {
    expect(parseBrowserRemoteControlRequest("Opened the pane.")).toBeNull();
    expect(parseBrowserRemoteControlRequest('{"message":"done"}')).toBeNull();
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
