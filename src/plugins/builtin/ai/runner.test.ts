import { afterEach, describe, expect, test } from "bun:test";
import { detectProviders, setDetectedProviders, type AiProvider } from "./providers";
import {
  checkAiProviderStatus,
  connectAiRuntimeProvider,
  disconnectAiRuntimeProvider,
  getAiRuntimeCatalog,
  getAiRuntimeCatalogSnapshot,
  installAiRunHost,
  queueAgentPromptFragment,
  resetQueuedAgentHarnessesForTests,
  runAiPrompt,
  setAiRunHost,
  setAiRuntimeCatalog,
  subscribeAiRuntimeCatalog,
  type AiRunHost,
  type AiRuntimeCatalog,
} from "./runner";

function catalog(connectionState: "connected" | "not_connected"): AiRuntimeCatalog {
  const connected = connectionState === "connected";
  return {
    providers: [{
      providerId: "openai-codex",
      label: "OpenAI (ChatGPT)",
      status: connected ? "ready" : "not_authenticated",
      ...(!connected ? { unavailableReason: "Not connected." } : {}),
      outputModes: ["plain", "structured", "screener"],
      defaultModelId: "gpt-5.6-sol",
    }],
    accounts: [{
      providerId: "openai-codex",
      providerLabel: "OpenAI (ChatGPT)",
      connectionState,
      connectionLabel: connected ? "Connected with OAuth" : "Not connected.",
      ...(connected
        ? { credentialSource: "OAuth", credentialOrigin: "stored" as const }
        : {}),
      authMethods: [{ type: "oauth", label: "ChatGPT Plus/Pro", canLogin: true }],
      canLogin: true,
      canDisconnect: connected,
      loginType: "oauth",
    }],
    models: [{
      id: "gpt-5.6-sol",
      providerId: "openai-codex",
      label: "GPT-5.6 Sol",
      available: connected,
    }],
  };
}

const originalLanguageModel = (globalThis as { LanguageModel?: unknown }).LanguageModel;

afterEach(() => {
  setAiRunHost(null);
  resetQueuedAgentHarnessesForTests();
  setAiRuntimeCatalog({ providers: [], accounts: [], models: [] });
  setDetectedProviders(null);
  (globalThis as { LanguageModel?: unknown }).LanguageModel = originalLanguageModel;
  delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
});

describe("plugin agent harness queue", () => {
  test("replays prompt fragments when the AI host is installed later", () => {
    const fragments: string[] = [];
    queueAgentPromptFragment("CFTC filings: pane.createFromTemplate cftc-filings-pane.");
    setAiRunHost({
      run: () => ({ done: Promise.resolve(""), cancel() {} }),
      registerAgentPromptFragment(fragment) { fragments.push(fragment); },
    });
    expect(fragments).toEqual(["CFTC filings: pane.createFromTemplate cftc-filings-pane."]);
  });
});

describe("AI runtime catalog", () => {
  test("publishes stable snapshots for set, connect, and disconnect", async () => {
    const connected = catalog("connected");
    const disconnected = catalog("not_connected");
    const snapshots: AiRuntimeCatalog[] = [];
    const authEvents: unknown[] = [];
    const unsubscribe = subscribeAiRuntimeCatalog(() => {
      snapshots.push(getAiRuntimeCatalogSnapshot());
    });
    setAiRunHost({
      run: () => ({ done: Promise.resolve("unused"), cancel() {} }),
      connect: async (_providerId, _authType, onAuthEvent) => {
        onAuthEvent?.({
          type: "device_code",
          userCode: "ABCD-EFGH",
          verificationUri: "https://github.com/login/device",
        });
        return connected;
      },
      disconnect: async () => disconnected,
    });

    const initialSnapshot = getAiRuntimeCatalogSnapshot();
    setAiRuntimeCatalog(disconnected);
    const setSnapshot = getAiRuntimeCatalogSnapshot();
    expect(setSnapshot).not.toBe(initialSnapshot);
    expect(getAiRuntimeCatalogSnapshot()).toBe(setSnapshot);

    await connectAiRuntimeProvider("codex", undefined, (event) => {
      authEvents.push(event);
    });
    const connectSnapshot = getAiRuntimeCatalogSnapshot();
    expect(connectSnapshot.accounts[0]?.connectionState).toBe("connected");
    expect(connectSnapshot).not.toBe(setSnapshot);
    expect(authEvents).toEqual([{
      type: "device_code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
    }]);

    await disconnectAiRuntimeProvider("openai-codex");
    expect(getAiRuntimeCatalogSnapshot().accounts[0]?.connectionState).toBe("not_connected");
    expect(snapshots).toHaveLength(3);

    unsubscribe();
    setAiRuntimeCatalog(connected);
    expect(snapshots).toHaveLength(3);
  });

  test("returns a defensive imperative copy including nested auth methods", () => {
    setAiRuntimeCatalog(catalog("connected"));
    const copy = getAiRuntimeCatalog();
    copy.providers[0]!.outputModes.length = 0;
    copy.accounts[0]!.authMethods[0]!.label = "mutated";

    expect(getAiRuntimeCatalogSnapshot().providers[0]?.outputModes).toEqual([
      "plain",
      "structured",
      "screener",
    ]);
    expect(getAiRuntimeCatalogSnapshot().accounts[0]?.authMethods[0]?.label)
      .toBe("ChatGPT Plus/Pro");
  });
});

describe("AI runner", () => {
  test("installs the run host before best-effort catalog discovery settles", async () => {
    const catalogErrors: unknown[] = [];
    const installation = installAiRunHost({
      run: () => ({ done: Promise.resolve("available"), cancel() {} }),
      getCatalog: () => new Promise(() => {}),
    }, {
      catalogTimeoutMs: 5,
      timeoutMessage: "AI discovery timed out",
      onCatalogError: (error) => catalogErrors.push(error),
    });

    await expect(runAiPrompt({
      providerId: "anthropic",
      prompt: "hello",
    }).done).resolves.toBe("available");
    await expect(installation).resolves.toEqual({ providers: [], accounts: [], models: [] });
    expect(catalogErrors).toHaveLength(1);
    expect(catalogErrors[0]).toMatchObject({ message: "AI discovery timed out" });
  });

  test("does not publish an empty catalog after discovery failure", async () => {
    const ready: AiProvider = {
      id: "anthropic",
      name: "Claude",
      available: true,
      status: "ready",
      outputModes: ["plain", "structured", "screener"],
    };
    setAiRuntimeCatalog(catalog("connected"));
    setDetectedProviders([ready]);
    await installAiRunHost({
      run: () => ({ done: Promise.resolve("unused"), cancel() {} }),
      getCatalog: async () => ({ providers: [], accounts: [], models: [] }),
    }, {
      catalogTimeoutMs: 50,
      timeoutMessage: "AI discovery timed out",
    });
    expect(getAiRuntimeCatalog().providers[0]?.providerId).toBe("openai-codex");
    expect(detectProviders().some((provider) => provider.id === "anthropic")).toBe(true);
  });

  test("delegates canonical provider id, model, and structured history to the native host", async () => {
    type RunOptions = Parameters<AiRunHost["run"]>[0];
    const received: RunOptions[] = [];
    let cancelled = false;
    setAiRunHost({
      run(options) {
        received.push(options);
        return {
          done: Promise.resolve("host output"),
          cancel: () => { cancelled = true; },
        };
      },
    });

    const run = runAiPrompt({
      // Legacy values are accepted only at this migration boundary.
      providerId: "codex",
      prompt: "Current request",
      messages: [
        { role: "user", content: "Earlier request" },
        { role: "assistant", content: "Earlier response" },
      ],
      modelId: "gpt-5.6-sol",
      outputMode: "structured",
    });
    run.cancel();

    expect(await run.done).toBe("host output");
    expect(received).toEqual([{
      providerId: "openai-codex",
      prompt: "Current request",
      messages: [
        { role: "user", content: "Earlier request" },
        { role: "assistant", content: "Earlier response" },
      ],
      agentMessages: undefined,
      modelId: "gpt-5.6-sol",
      onChunk: undefined,
      onThinking: undefined,
      onAgentMessages: undefined,
      outputMode: "structured",
    }]);
    expect(cancelled).toBe(true);
  });

  test("fails clearly when the native runtime is unavailable or provider id is unknown", async () => {
    await expect(runAiPrompt({
      providerId: "anthropic",
      prompt: "hello",
    }).done).rejects.toThrow("native AI runtime is unavailable");

    setAiRunHost({
      run: () => ({ done: Promise.resolve("unused"), cancel() {} }),
    });
    await expect(runAiPrompt({
      providerId: "opencode",
      prompt: "hello",
    }).done).rejects.toThrow("Unknown AI provider: opencode");
  });
});

describe("checkAiProviderStatus timeout", () => {
  // Implementation waits the full 5s hang timeout; give the suite headroom under load.
  test("reaches a terminal state when the host checkStatus hangs", async () => {
    setAiRunHost({
      run: () => ({ done: Promise.resolve("unused"), cancel() {} }),
      checkStatus: () => new Promise(() => {}), // never resolves
    });
    const result = await checkAiProviderStatus("anthropic");
    expect(result.available).toBe(false);
    expect(result.authenticated).toBe(false);
    expect(result.inconclusive).toBe(true);
    expect(result.message).toContain("timed out");
  }, 10_000);

  test("returns the host result when checkStatus resolves quickly", async () => {
    setAiRunHost({
      run: () => ({ done: Promise.resolve("unused"), cancel() {} }),
      checkStatus: async () => ({
        available: true,
        authenticated: true,
        message: null,
      }),
    });
    const result = await checkAiProviderStatus("anthropic");
    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(true);
  });

  test("falls back to the runtime catalog when no host checkStatus is configured", async () => {
    setAiRunHost(null);
    setAiRuntimeCatalog(catalog("connected"));
    const result = await checkAiProviderStatus("openai-codex");
    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(true);
  });

  test("checks browser-builtin via the Prompt API instead of host RPC", async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => "available",
      create: async () => ({}),
    };
    setAiRunHost({
      run: () => ({ done: Promise.resolve("unused"), cancel() {} }),
      checkStatus: () => new Promise(() => {}),
    });
    const result = await checkAiProviderStatus("browser-builtin");
    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(result.message).toBeNull();
  });
});
