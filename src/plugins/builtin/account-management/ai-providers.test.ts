import { describe, expect, test } from "bun:test";
import type { AiRuntimeCatalog } from "../ai/runner";
import type { BrowserAiState } from "../ai/browser";
import {
  aiInventoryFixAction,
  aiInventoryStatusLabel,
  aiInventoryStatusColor,
  byokKeysConfigSelector,
  canSelectAiProvider,
  checkOllamaAvailability,
  OLLAMA_DEFAULT_URL,
  resolveAiInventory,
  resolveOllamaEndpoint,
  type AiProviderInventoryRow,
  type OllamaAvailability,
} from "./ai-providers";
import type { ByokApiKeyEntry } from "../byok/types";
import type { AppConfig } from "../../../types/config";

function emptyCatalog(): AiRuntimeCatalog {
  return { providers: [], accounts: [], models: [] };
}

function catalogWithConnected(providerId: string): AiRuntimeCatalog {
  return {
    providers: [{
      providerId: providerId as any,
      label: providerId,
      status: "ready",
      outputModes: ["plain", "structured", "screener"],
    }],
    accounts: [{
      providerId: providerId as any,
      providerLabel: providerId,
      connectionState: "connected",
      connectionLabel: "Connected.",
      authMethods: [],
      canLogin: false,
      canDisconnect: true,
    }],
    models: [],
  };
}

function catalogWithError(providerId: string): AiRuntimeCatalog {
  return {
    providers: [{
      providerId: providerId as any,
      label: providerId,
      status: "check_failed",
      unavailableReason: "Auth failed.",
      outputModes: ["plain", "structured", "screener"],
    }],
    accounts: [{
      providerId: providerId as any,
      providerLabel: providerId,
      connectionState: "error",
      connectionLabel: "Auth failed.",
      authMethods: [],
      canLogin: false,
      canDisconnect: false,
    }],
    models: [],
  };
}

function byokKey(serviceId: string, apiKey = "sk-test"): ByokApiKeyEntry {
  return {
    id: `byok-${serviceId}`,
    serviceId,
    name: serviceId,
    apiKey,
    createdAt: Date.now(),
    lastValidationStatus: "untested",
  };
}

const browserAvailable: BrowserAiState = { availability: "available", reason: "Ready." };
const browserUnavailable: BrowserAiState = { availability: "unavailable", reason: "Not available." };

describe("AI provider inventory status resolution", () => {
  test("Chrome built-in AI is available on hosted when the model is ready", () => {
    Object.defineProperty(globalThis, "__GLOOM_CLOUD_HOSTED", { configurable: true, value: true });
    const snapshot = resolveAiInventory({
      catalog: emptyCatalog(),
      browserAiState: browserAvailable,
      ollamaState: null,
      byokKeys: [],
      activeProviderId: "browser-builtin",
    });
    const browser = snapshot.rows[0]!;
    expect(browser.id).toBe("browser-builtin");
    expect(browser.status).toBe("available");
    expect(browser.preferred).toBe(true);
    expect(canSelectAiProvider(browser)).toBe(true);
    delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
  });

  test("Chrome built-in AI is listed first, preferred, and reflects browser state", () => {
    // isHostedWebClient() is false in the test environment, so Chrome shows
    // unavailable even with a positive browser state. Verify ordering and
    // preferred label still hold.
    const snapshot = resolveAiInventory({
      catalog: emptyCatalog(),
      browserAiState: browserAvailable,
      ollamaState: null,
      byokKeys: [],
      activeProviderId: "browser-builtin",
    });
    const first = snapshot.rows[0]!;
    expect(first.id).toBe("browser-builtin");
    expect(first.preferred).toBe(true);
    expect(first.isActive).toBe(true);
  });

  test("Chrome built-in AI shows unavailable on non-hosted renderers", () => {
    // isHostedWebClient() is false in the test environment
    const snapshot = resolveAiInventory({
      catalog: emptyCatalog(),
      browserAiState: browserAvailable,
      ollamaState: null,
      byokKeys: [],
      activeProviderId: null,
    });
    const browser = snapshot.rows.find((r) => r.id === "browser-builtin")!;
    expect(browser.status).toBe("unavailable");
    expect(browser.preferred).toBe(true);
  });

  test("Ollama shows available when the local server is running", () => {
    const snapshot = resolveAiInventory({
      catalog: emptyCatalog(),
      browserAiState: null,
      ollamaState: "available",
      byokKeys: [],
      activeProviderId: "ollama",
    });
    const ollama = snapshot.rows.find((r) => r.id === "ollama")!;
    expect(ollama.status).toBe("available");
    expect(ollama.isActive).toBe(true);
    expect(ollama.isLocal).toBe(true);
    expect(ollama.byokServiceId).toBe("ollama");
  });

  test("Ollama shows unavailable when the server is not running", () => {
    const snapshot = resolveAiInventory({
      catalog: emptyCatalog(),
      browserAiState: null,
      ollamaState: "unavailable",
      byokKeys: [],
      activeProviderId: null,
    });
    const ollama = snapshot.rows.find((r) => r.id === "ollama")!;
    expect(ollama.status).toBe("unavailable");
    expect(ollama.detail).toContain("ollama serve");
  });

  test("Ollama uses a custom endpoint from BYOK keys", () => {
    const keys = [byokKey("ollama")];
    const customKey: ByokApiKeyEntry = { ...byokKey("ollama"), apiUrl: "http://my-host:11434" };
    const endpoint = resolveOllamaEndpoint([customKey]);
    expect(endpoint).toBe("http://my-host:11434");
    expect(resolveOllamaEndpoint(keys)).toBe(OLLAMA_DEFAULT_URL);
    expect(resolveOllamaEndpoint([])).toBe(OLLAMA_DEFAULT_URL);
  });

  test("Pi provider shows available when connected via OAuth", () => {
    const snapshot = resolveAiInventory({
      catalog: catalogWithConnected("anthropic"),
      browserAiState: null,
      ollamaState: null,
      byokKeys: [],
      activeProviderId: "anthropic",
    });
    const anthropic = snapshot.rows.find((r) => r.id === "anthropic")!;
    expect(anthropic.status).toBe("available");
    expect(anthropic.isActive).toBe(true);
    expect(anthropic.canOAuth).toBe(false); // no oauth authMethod in the mock
  });

  test("Pi provider shows available when a BYOK key exists", () => {
    const snapshot = resolveAiInventory({
      catalog: emptyCatalog(),
      browserAiState: null,
      ollamaState: null,
      byokKeys: [byokKey("openai")],
      activeProviderId: "openai",
    });
    const openai = snapshot.rows.find((r) => r.id === "openai")!;
    expect(openai.status).toBe("available");
    expect(openai.hasKey).toBe(true);
  });

  test("Pi provider shows needs-key when no key and not connected", () => {
    const snapshot = resolveAiInventory({
      catalog: emptyCatalog(),
      browserAiState: null,
      ollamaState: null,
      byokKeys: [],
      activeProviderId: null,
    });
    const anthropic = snapshot.rows.find((r) => r.id === "anthropic")!;
    expect(anthropic.status).toBe("needs-key");
    expect(aiInventoryFixAction(anthropic)?.kind).toBe("add-key");
  });

  test("Pi provider shows error when connection state is error", () => {
    const snapshot = resolveAiInventory({
      catalog: catalogWithError("anthropic"),
      browserAiState: null,
      ollamaState: null,
      byokKeys: [],
      activeProviderId: null,
    });
    const anthropic = snapshot.rows.find((r) => r.id === "anthropic")!;
    expect(anthropic.status).toBe("error");
    expect(aiInventoryStatusLabel(anthropic.status)).toBe("Error");
    expect(aiInventoryStatusColor(anthropic.status)).toBe("negative");
  });

  test("every provider reaches a terminal status — never checking — except while Ollama is being probed", () => {
    const snapshot = resolveAiInventory({
      catalog: emptyCatalog(),
      browserAiState: browserUnavailable,
      ollamaState: null,
      byokKeys: [],
      activeProviderId: null,
    });
    for (const row of snapshot.rows) {
      // Without a running Ollama or hosted Chrome, every provider must be in
      // a terminal state. "checking" is only valid transiently for Ollama.
      if (row.id === "ollama" && row.status === "checking") continue;
      expect(["available", "needs-key", "unavailable", "error"]).toContain(row.status);
    }
  });
});

describe("AI provider active-provider selection", () => {
  test("canSelectAiProvider returns true for available providers and providers with keys", () => {
    const available: AiProviderInventoryRow = {
      id: "anthropic", name: "Claude", status: "available", detail: "",
      isActive: false, preferred: false, hasKey: false, canOAuth: true, isLocal: false, byokServiceId: "anthropic",
    };
    const withKey: AiProviderInventoryRow = { ...available, status: "needs-key", hasKey: true };
    const noKey: AiProviderInventoryRow = { ...available, status: "needs-key", hasKey: false, canOAuth: false };
    const unavailable: AiProviderInventoryRow = { ...available, status: "unavailable" };
    expect(canSelectAiProvider(available)).toBe(true);
    expect(canSelectAiProvider(withKey)).toBe(true);
    expect(canSelectAiProvider(noKey)).toBe(false);
    expect(canSelectAiProvider(unavailable)).toBe(false);
    const browserDownloadable: AiProviderInventoryRow = {
      id: "browser-builtin", name: "Browser", status: "needs-key", detail: "",
      isActive: false, preferred: true, hasKey: false, canOAuth: false, isLocal: true, byokServiceId: null,
    };
    expect(canSelectAiProvider(browserDownloadable)).toBe(true);
  });

  test("only one provider is active at a time", () => {
    const snapshot = resolveAiInventory({
      catalog: catalogWithConnected("anthropic"),
      browserAiState: null,
      ollamaState: null,
      byokKeys: [],
      activeProviderId: "anthropic",
    });
    const activeRows = snapshot.rows.filter((r) => r.isActive);
    expect(activeRows.length).toBe(1);
    expect(activeRows[0]!.id).toBe("anthropic");
  });

  test("no provider is active when activeProviderId is null", () => {
    const snapshot = resolveAiInventory({
      catalog: emptyCatalog(),
      browserAiState: null,
      ollamaState: null,
      byokKeys: [],
      activeProviderId: null,
    });
    expect(snapshot.rows.filter((r) => r.isActive).length).toBe(0);
    expect(snapshot.activeProviderId).toBe(null);
  });
});

describe("AI provider fix actions", () => {
  test("available providers have no fix action", () => {
    const row: AiProviderInventoryRow = {
      id: "anthropic", name: "Claude", status: "available", detail: "",
      isActive: true, preferred: false, hasKey: true, canOAuth: false, isLocal: false, byokServiceId: "anthropic",
    };
    expect(aiInventoryFixAction(row)).toBe(null);
  });

  test("Ollama fix action is start-ollama", () => {
    const row: AiProviderInventoryRow = {
      id: "ollama", name: "Ollama", status: "unavailable", detail: "",
      isActive: false, preferred: false, hasKey: false, canOAuth: false, isLocal: true, byokServiceId: "ollama",
    };
    expect(aiInventoryFixAction(row)?.kind).toBe("start-ollama");
  });

  test("Chrome downloadable fix action is download-model", () => {
    const row: AiProviderInventoryRow = {
      id: "browser-builtin", name: "Browser", status: "needs-key", detail: "",
      isActive: false, preferred: true, hasKey: false, canOAuth: false, isLocal: true, byokServiceId: null,
    };
    expect(aiInventoryFixAction(row)?.kind).toBe("download-model");
  });

  test("Pi provider without key fix action is add-key", () => {
    const row: AiProviderInventoryRow = {
      id: "openai", name: "OpenAI", status: "needs-key", detail: "",
      isActive: false, preferred: false, hasKey: false, canOAuth: false, isLocal: false, byokServiceId: "openai",
    };
    expect(aiInventoryFixAction(row)?.kind).toBe("add-key");
  });
});

describe("BYOK keys config selector", () => {
  test("reads keys from the application plugin config namespace", () => {
    const config: AppConfig = {
      pluginConfig: {
        application: {
          byokApiKeys: { keys: [byokKey("anthropic")] },
        },
      },
    } as unknown as AppConfig;
    const keys = byokKeysConfigSelector({ config });
    expect(keys.length).toBe(1);
    expect(keys[0]!.serviceId).toBe("anthropic");
  });

  test("returns empty array when no keys are stored", () => {
    const config: AppConfig = { pluginConfig: {} } as unknown as AppConfig;
    expect(byokKeysConfigSelector({ config })).toEqual([]);
  });
});

describe("Ollama availability check", () => {
  test("returns unavailable when the endpoint is not reachable", async () => {
    const result = await checkOllamaAvailability("http://localhost:1");
    expect(result.availability).toBe("unavailable");
    expect(result.models).toEqual([]);
  });

  test("returns unavailable for an invalid URL", async () => {
    const result = await checkOllamaAvailability("not-a-url");
    expect(result.availability).toBe("unavailable");
  });
});
