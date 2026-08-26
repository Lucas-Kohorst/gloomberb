import { afterEach, describe, expect, test } from "bun:test";
import {
  AI_PROVIDER_IDS,
  detectProviders,
  getAiProvider,
  getAiProviderDefinitions,
  migrateLegacyAiProviderId,
  resolveDefaultAiProviderId,
  setDetectedProviders,
} from "./providers";
import { setAiRuntimeCatalog } from "./runner";
import {
  GLOOMBERB_PI_PROVIDER_FACTORIES,
  GLOOMBERB_PI_PROVIDER_IDS,
} from "./pi/providers";

describe("Pi provider catalog", () => {
  afterEach(() => {
    delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
    setDetectedProviders(null);
    setAiRuntimeCatalog({ providers: [], accounts: [], models: [] });
  });
  test("exposes exactly the curated canonical providers in a stable order", () => {
    expect(AI_PROVIDER_IDS).toEqual([
      "browser-builtin",
      "ollama",
      "anthropic",
      "openai-codex",
      "openai",
      "google",
      "github-copilot",
      "xai",
      "openrouter",
      "deepseek",
      "groq",
      "cerebras",
      "mistral",
      "together",
      "fireworks",
      "amazon-bedrock",
      "google-vertex",
    ]);
    expect(GLOOMBERB_PI_PROVIDER_IDS).toEqual(AI_PROVIDER_IDS.filter((id) => id !== "browser-builtin" && id !== "ollama"));
    expect(new Set(AI_PROVIDER_IDS).size).toBe(AI_PROVIDER_IDS.length);
    expect(AI_PROVIDER_IDS).not.toContain("opencode");
    expect(AI_PROVIDER_IDS).not.toContain("pi");
  });

  test("keeps UI metadata and curated defaults aligned with Pi models", () => {
    const definitions = getAiProviderDefinitions();
    const piProviders = GLOOMBERB_PI_PROVIDER_FACTORIES.map((createProvider) => createProvider());

    expect(definitions.map((provider) => provider.id)).toEqual([...AI_PROVIDER_IDS]);
    for (const definition of definitions) {
      const provider = piProviders.find((candidate) => candidate.id === definition.id);
      if (definition.id === "browser-builtin") {
        expect(definition.outputModes).toEqual(["plain", "screener"]);
        continue;
      }
      if (definition.id === "ollama") {
        expect(definition.outputModes).toEqual(["plain"]);
        continue;
      }
      expect(provider).toBeDefined();
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.outputModes).toEqual(["plain", "structured", "screener"]);
      expect(definition.preferredModelIds.length).toBeGreaterThan(0);
      expect(provider?.getModels().some((model) => (
        definition.preferredModelIds.includes(model.id)
      ))).toBe(true);
      expect(definition).not.toHaveProperty("command");
      expect(definition).not.toHaveProperty("buildArgs");
    }
  });

  test("uses the browser provider only as the hosted web default", () => {
    Object.defineProperty(globalThis, "__GLOOM_CLOUD_HOSTED", { configurable: true, value: true });
    const browser = {
      id: "browser-builtin" as const,
      name: "Browser (on-device)",
      available: true,
      status: "ready" as const,
      outputModes: ["plain" as const],
    };
    const remote = {
      id: "anthropic" as const,
      name: "Claude",
      available: true,
      status: "ready" as const,
      outputModes: ["plain" as const],
    };
    expect(resolveDefaultAiProviderId([remote, browser])).toBe("browser-builtin");
    expect(resolveDefaultAiProviderId([{ ...browser, status: "not_authenticated" as const, available: false }, remote])).toBe("browser-builtin");
    expect(resolveDefaultAiProviderId([{ ...browser, status: "check_failed", available: false }, remote])).toBe("anthropic");
  });

  test("does not cache an empty catalog as a successful detection", () => {
    Object.defineProperty(globalThis, "__GLOOM_CLOUD_HOSTED", { configurable: true, value: true });
    setAiRuntimeCatalog({ providers: [], accounts: [], models: [] });
    setDetectedProviders([]);
    const providers = detectProviders();
    expect(providers.some((provider) => provider.id === "browser-builtin")).toBe(true);
    expect(providers.length).toBeGreaterThan(1);
  });

  test("lists browser-builtin only on the hosted web client", () => {
    setDetectedProviders(null);
    expect(detectProviders().some((provider) => provider.id === "browser-builtin")).toBe(false);
    Object.defineProperty(globalThis, "__GLOOM_CLOUD_HOSTED", { configurable: true, value: true });
    setDetectedProviders(null);
    expect(detectProviders().some((provider) => provider.id === "browser-builtin")).toBe(true);
  });

  test("uses legacy ids only to migrate persisted selections", () => {
    expect(migrateLegacyAiProviderId("claude")).toBe("anthropic");
    expect(migrateLegacyAiProviderId("codex")).toBe("openai-codex");
    expect(migrateLegacyAiProviderId("gemini")).toBe("google");
    expect(migrateLegacyAiProviderId("openai")).toBe("openai");
    expect(migrateLegacyAiProviderId("opencode")).toBe("opencode");

    setDetectedProviders(getAiProviderDefinitions().map((definition) => ({
      id: definition.id,
      name: definition.name,
      available: false,
      status: "not_authenticated",
      outputModes: [...definition.outputModes],
    })));
    expect(getAiProvider("claude")?.id).toBe("anthropic");
    expect(getAiProvider("codex")?.id).toBe("openai-codex");
    setDetectedProviders(null);
  });
});
